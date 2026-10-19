import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
  ELECTRON_UPDATER_FALLBACK_FEEDS,
  checkForUpdatesWithFeedFallback,
  staleUpdaterStatePaths,
  electronUpdaterFeedConfig,
  downloadUpdateReady,
} from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };

describe("downloadUpdateReady", () => {
  it("waits for macOS to finish unpacking after the ZIP transfer", async () => {
    const native = new EventEmitter();
    let downloaded = false, ready = false;
    const result = downloadUpdateReady({ async downloadUpdate() { downloaded = true; } }, native).then(() => { ready = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloaded, true);
    assert.equal(ready, false);
    native.emit("update-downloaded");
    await result;
    assert.equal(ready, true);
    assert.equal(native.listenerCount("error"), 0);
    assert.equal(native.listenerCount("update-downloaded"), 0);
  });

  it("reports an unpacking failure after downloadUpdate has already resolved", async () => {
    const native = new EventEmitter();
    const result = downloadUpdateReady({ async downloadUpdate() {} }, native);
    const rejected = assert.rejects(result, /No space left on device/);
    await new Promise((resolve) => setImmediate(resolve));
    native.emit("error", new Error("ditto: No space left on device"));
    await rejected;
    assert.equal(native.listenerCount("update-downloaded"), 0);
  });

  it("subscribes before starting a cached download and still waits for its promise", async () => {
    const native = new EventEmitter();
    /** @type {() => void} */
    let finish = () => assert.fail("download must start first");
    let ready = false;
    const result = downloadUpdateReady({ downloadUpdate() {
      native.emit("update-downloaded");
      return new Promise((resolve) => { finish = () => resolve(undefined); });
    } }, native).then(() => { ready = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ready, false);
    finish();
    await result;
    assert.equal(native.listenerCount("error"), 0);
  });

  it("cleans up native listeners when the download fails", async () => {
    const native = new EventEmitter();
    await assert.rejects(downloadUpdateReady({ async downloadUpdate() { throw new Error("Download failed"); } }, native), /Download failed/);
    assert.equal(native.listenerCount("error"), 0);
    assert.equal(native.listenerCount("update-downloaded"), 0);
  });

  it("times out a missing native completion event so retry remains possible", async () => {
    const native = new EventEmitter();
    await assert.rejects(downloadUpdateReady({ async downloadUpdate() {} }, native, 10), /could not finish preparing/);
    assert.equal(native.listenerCount("error"), 0);
    assert.equal(native.listenerCount("update-downloaded"), 0);
  });

  it("keeps the download promise as readiness off macOS", async () => {
    let downloaded = false;
    await downloadUpdateReady({ async downloadUpdate() { downloaded = true; } }, null);
    assert.equal(downloaded, true);
    await assert.rejects(downloadUpdateReady({ async downloadUpdate() { throw new Error("Download failed"); } }, null), /Download failed/);
  });
});

it("keeps Windows installer architectures separate on every update feed", () => {
  for (const url of ["https://eigenweltlabs.com/legalwork/update", ELECTRON_UPDATER_FALLBACK_FEEDS.stable, "https://example.test/alpha"]) {
    assert.deepEqual(electronUpdaterFeedConfig(url, "win32", "arm64"), { provider: "generic", url, channel: "latest-arm64" });
    assert.deepEqual(electronUpdaterFeedConfig(url, "win32", "x64"), { provider: "generic", url });
    assert.deepEqual(electronUpdaterFeedConfig(url, "darwin", "arm64"), { provider: "generic", url });
  }
});

/* A shipped app that can no longer self-update is the worst failure mode, so
   the feed fallback chain gets exercised directly: primary feed -> GitHub. */
describe("checkForUpdatesWithFeedFallback", () => {
  // No channel file in this userData dir -> the stable channel is used.
  const feedApp = {
    isPackaged: true,
    getVersion: () => "0.1.0",
    getPath: () => path.join(os.tmpdir(), "legalwork-updater-test-userdata"),
  };

  // `versions` maps a feed-URL prefix to the version that feed advertises
  // (default "9.9.9", i.e. an available update).
  function fakeUpdater({ failFeeds, versions = {} }) {
    return {
      feedUrls: [],
      setFeedURL({ url }) {
        this.feedUrls.push(url);
      },
      async checkForUpdates() {
        const current = this.feedUrls[this.feedUrls.length - 1];
        if (failFeeds.some((feed) => current.startsWith(feed))) {
          throw new Error(`feed unreachable: ${current}`);
        }
        const match = Object.entries(versions).find(([feed]) => current.startsWith(feed));
        return { updateInfo: { version: match ? match[1] : "9.9.9" } };
      },
    };
  }

  it("uses the tracked feed when it answers", async () => {
    const updater = fakeUpdater({ failFeeds: [] });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(channelState.feedUrl, "https://eigenweltlabs.com/legalwork/update");
    assert.equal(channelState.feedFallback, false);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.deepEqual(updater.feedUrls, ["https://eigenweltlabs.com/legalwork/update"]);
  });

  it("falls back to GitHub when the tracked feed errors", async () => {
    const updater = fakeUpdater({ failFeeds: ["https://eigenweltlabs.com"] });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, ELECTRON_UPDATER_FALLBACK_FEEDS.stable);
    assert.equal(result.updateInfo.version, "9.9.9");
    // The GitHub feed must stay applied so the follow-up download uses it too.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      ELECTRON_UPDATER_FALLBACK_FEEDS.stable,
    );
  });

  it("throws only when both feeds fail, tagging the error against redundant retries", async () => {
    const updater = fakeUpdater({ failFeeds: ["https://eigenweltlabs.com", "https://github.com"] });
    const error = await checkForUpdatesWithFeedFallback(feedApp, updater).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.match(String(error?.message), /feed unreachable: https:\/\/github\.com/);
    // The tag tells the IPC handlers' last-ditch recovery that GitHub was
    // already tried, so they don't repeat the identical request.
    assert.equal(error.githubFallbackAttempted, true);
  });

  /* A tracked feed that answers with valid-but-stale data never errors, so the
     error fallback alone would pin the fleet on the current version. The
     freshness cross-check is what heals that. */
  it("cross-checks GitHub on 'no update' and prefers the newer version", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { "https://eigenweltlabs.com": "0.1.0" }, // stale: equals current
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, ELECTRON_UPDATER_FALLBACK_FEEDS.stable);
    // GitHub must stay applied so the follow-up download resolves against it.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      ELECTRON_UPDATER_FALLBACK_FEEDS.stable,
    );
  });

  it("keeps the tracked feed's answer when GitHub agrees there is no update", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { "https://eigenweltlabs.com": "0.1.0", "https://github.com": "0.1.0" },
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    // The tracked feed is re-applied after the cross-check.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      "https://eigenweltlabs.com/legalwork/update",
    );
  });

  it("ignores a failing GitHub cross-check when the tracked feed answered", async () => {
    const updater = fakeUpdater({
      failFeeds: ["https://github.com"],
      versions: { "https://eigenweltlabs.com": "0.1.0" },
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      "https://eigenweltlabs.com/legalwork/update",
    );
  });
});

describe("staleUpdaterStatePaths", () => {
  it("targets the ShipIt cache on macOS", { skip: process.platform !== "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), [
      "/Users/test/Library/Caches/com.eigenweltlabs.legalwork.ShipIt",
    ]);
  });

  it("is a no-op off macOS", { skip: process.platform === "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), []);
  });
});
