import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertPackagedOpencodeSelection } from "../scripts/packaged-opencode-selection.mjs";

const selection = (binary) => {
  const manifestContent = JSON.stringify({ version: "2.1.4-legalwork.http-policy.3", binary });
  return { schemaVersion: 1, kind: "derivative", version: "2.1.4-legalwork.http-policy.3", baseVersion: "2.1.4",
    manifestContent, manifestSha256: createHash("sha256").update(manifestContent).digest("hex"), downloadBaseUrl: "https://example.invalid/reviewed/" };
};

test("the complete packaged selection matches its reviewed build input", () => {
  const reviewed = selection("signed engine");
  assert.doesNotThrow(() => assertPackagedOpencodeSelection(structuredClone(reviewed), reviewed));
});

test("a previous self-pinned distribution of the same engine version is rejected", () => {
  const reviewed = selection("signed engine"), previous = selection("previous unsigned engine");
  assert.equal(previous.version, reviewed.version);
  assert.throws(() => assertPackagedOpencodeSelection(previous, reviewed), /must exactly match/);
});

test("a different archive source or any changed or missing compiled pin is rejected", () => {
  const reviewed = selection("signed engine");
  for (const changed of [{ ...reviewed, downloadBaseUrl: "https://example.invalid/previous/" },
    { ...reviewed, manifestSha256: "0".repeat(64) }, { ...reviewed, manifestContent: reviewed.manifestContent + "\n" },
    { ...reviewed, kind: "official" }, { ...reviewed, extra: true }]) {
    assert.throws(() => assertPackagedOpencodeSelection(changed, reviewed), /must exactly match/);
  }
  const missing = { ...reviewed }; delete missing.downloadBaseUrl;
  assert.throws(() => assertPackagedOpencodeSelection(missing, reviewed), /must exactly match/);
});
