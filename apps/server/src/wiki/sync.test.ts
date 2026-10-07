import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";
import { buildFrontmatter, parseFrontmatter } from "../frontmatter.js";
import { checkCondition, type FileData, type DownloadedFile, type StorageAdapter, type WriteCondition } from "../file-storage/common.js";
import { WikiStore } from "./store.js";
import { WikiSync } from "./sync.js";

class MemoryStorage implements StorageAdapter {
  files = new Map<string, FileData>();
  revision = 0;
  failManifest = false;
  beforeRead?: (path: string) => Promise<void>;
  afterWrite?: (path: string) => Promise<void>;
  async list() { return { entries: [] }; }
  async stat(path: string) { return this.files.get(path) ?? null; }
  async read(path: string) {
    await this.beforeRead?.(path);
    const file = this.files.get(path);
    if (!file) throw new ApiError(404, "missing", "Missing remote object");
    return { ...file, data: Buffer.from(file.data) };
  }
  async write(path: string, data: Buffer, contentType: string, condition: WriteCondition) {
    if (this.failManifest && path.endsWith("Manifest.md")) throw new ApiError(409, "conflict", "Concurrent publication");
    checkCondition(this.files.get(path) ?? null, condition);
    this.files.set(path, { data: Buffer.from(data), size: data.length, version: String(++this.revision), contentType });
    await this.afterWrite?.(path);
  }
  async mkdir() {}
  async upload() { throw new Error("Unused streaming operation"); }
  async download(): Promise<DownloadedFile> { throw new Error("Unused streaming operation"); }
}
const roots: string[] = [], stores: WikiStore[] = [], syncers: WikiSync[] = [];
afterEach(async () => {
  await Promise.all(syncers.splice(0).map((sync) => sync.stop()));
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function copy(remote: MemoryStorage) {
  const root = await mkdtemp(join(tmpdir(), "wiki-sync-")); roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const store = new WikiStore(config); stores.push(store);
  const wiki = await store.create({ name: "Shared", root: join(root, "content"), attach: true,
    sync: { workspaceId: "project", connectionId: "shared", path: "Knowledge" } });
  const access = { readOnly: false, denied: false, offline: false };
  const sync = new WikiSync(config, store, { intervalMs: 30, storage: async () => {
    if (access.denied) throw new ApiError(403, "revoked", "Access revoked");
    if (access.offline) throw new ApiError(503, "offline", "Offline");
    return { readOnly: access.readOnly, run: (fn) => fn(remote) };
  } }); syncers.push(sync);
  return { root, config, store, wiki, sync, access,
    save: async (path: string, content: string) => {
      const previous = await store.read(wiki.id, path).catch(() => null);
      return store.write(wiki.id, path, content, previous?.revision ?? "");
    },
    read: async (path: string) => (await store.read(wiki.id, path)).content,
  };
}
const manifestPath = "Knowledge/.legalwork-wiki/Manifest.md";
async function exchange(a: Awaited<ReturnType<typeof copy>>, b: Awaited<ReturnType<typeof copy>>) {
  expect((await a.sync.sync(a.wiki.id)).state).toBe("idle");
  expect((await b.sync.sync(b.wiki.id)).state).toBe("idle");
}

describe("Wiki sync across two local folders", () => {
  test("publishes Markdown and binary attachments, merges separate edits, deletes and restores", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Process\n\nFirst paragraph.\n\nLast paragraph.\n");
    await a.store.writeAsset(a.wiki.id, "Sources/example.pdf", Buffer.from([0, 1, 255]), "");
    await exchange(a, b);
    expect(await b.store.readAsset(b.wiki.id, "Sources/example.pdf")).toEqual(Buffer.from([0, 1, 255]));
    await a.save("Page.md", "# Process\n\nFirst paragraph updated.\n\nLast paragraph.\n");
    await b.save("Page.md", "# Process\n\nFirst paragraph.\n\nLast paragraph expanded.\n");
    await exchange(a, b);
    await a.sync.sync(a.wiki.id);
    expect(await a.read("Page.md")).toContain("First paragraph updated.");
    expect(await a.read("Page.md")).toContain("Last paragraph expanded.");
    expect(await b.read("Page.md")).toBe(await a.read("Page.md"));
    const current = await a.store.read(a.wiki.id, "Page.md");
    const history = await a.store.history(a.wiki.id, "Page.md");
    await a.store.remove(a.wiki.id, "Page.md", current.revision);
    await exchange(a, b);
    await expect(b.read("Page.md")).rejects.toMatchObject({ status: 404 });
    await a.store.restore(a.wiki.id, "Page.md", history[0].id, "");
    await exchange(a, b);
    expect(await b.read("Page.md")).toBe(await a.read("Page.md"));
  });

  test("preserves overlapping edits as synchronized conflict copies", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Policy\n\nThe fee is 10.\n"); await exchange(a, b);
    await a.save("Page.md", "# Policy\n\nThe fee is 20.\n");
    await b.save("Page.md", "# Policy\n\nThe fee is 30.\n");
    await a.sync.sync(a.wiki.id);
    const result = await b.sync.sync(b.wiki.id);
    expect(result.conflicts).toContain("Page.md");
    const file = (await b.store.files(b.wiki.id)).find((file) => file.path.includes(".conflict-"));
    expect(file).toBeDefined();
    expect(await b.read(file!.path)).toContain("30");
    expect(await b.read("Page.md")).toContain("20");
    await a.sync.sync(a.wiki.id);
    expect(await a.read(file!.path)).toContain("30");
  });

  test("keeps an edit concurrent with deletion", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Original\n"); await exchange(a, b);
    const current = await a.store.read(a.wiki.id, "Page.md");
    await a.store.remove(a.wiki.id, "Page.md", current.revision);
    await b.save("Page.md", "# New knowledge\n");
    await a.sync.sync(a.wiki.id);
    expect((await b.sync.sync(b.wiki.id)).conflicts).toContain("Page.md");
    await a.sync.sync(a.wiki.id);
    expect(await a.read("Page.md")).toBe("# New knowledge\n");
  });

  test("failed conditional publication retains local text and retries without advancing its base", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Original\n"); await exchange(a, b);
    const manifest = Buffer.from((await remote.read(manifestPath)).data);
    await a.save("Page.md", "# Unsynced\n"); remote.failManifest = true;
    expect((await a.sync.sync(a.wiki.id)).state).toBe("error");
    expect(await a.read("Page.md")).toBe("# Unsynced\n");
    expect((await remote.read(manifestPath)).data).toEqual(manifest);
    remote.failManifest = false; await exchange(a, b);
    expect(await b.read("Page.md")).toBe("# Unsynced\n");
  });

  test("a local save made during a remote download survives and merges next round", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Shared\n\nFirst.\n\nLast.\n"); await exchange(a, b);
    await a.save("Page.md", "# Shared\n\nFirst updated.\n\nLast.\n"); await a.sync.sync(a.wiki.id);
    let once = false;
    remote.beforeRead = async (path) => {
      if (path.endsWith("/Page.md") && !once) { once = true; await b.save("Page.md", "# Shared\n\nFirst.\n\nLast updated.\n"); }
    };
    expect((await b.sync.sync(b.wiki.id)).state).toBe("idle");
    expect(await b.read("Page.md")).toContain("Last updated.");
    remote.beforeRead = undefined;
    await b.sync.sync(b.wiki.id); await a.sync.sync(a.wiki.id);
    expect(await b.read("Page.md")).toContain("First updated.");
    expect(await a.read("Page.md")).toContain("Last updated.");
  });

  test("read-only clients download; disabled/offline access never publishes; owner can queue offline edits", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Original\n"); await a.sync.sync(a.wiki.id);
    b.access.readOnly = true;
    expect((await b.sync.sync(b.wiki.id)).state).toBe("idle");
    expect(await b.read("Page.md")).toBe("# Original\n");
    await expect(b.sync.ensureWritable(b.wiki, true)).rejects.toMatchObject({ status: 403 });
    b.access.readOnly = false; b.access.offline = true;
    await b.sync.ensureWritable(b.wiki, true);
    await expect(b.sync.ensureWritable(b.wiki)).rejects.toMatchObject({ status: 503 });
    await b.save("Page.md", "# Queued\n");
    expect((await b.sync.sync(b.wiki.id)).state).toBe("error");
    b.access.offline = false; b.access.denied = true;
    await expect(b.sync.ensureWritable(b.wiki, true)).rejects.toMatchObject({ status: 403 });
    expect((await b.sync.sync(b.wiki.id)).state).toBe("error");
    b.access.denied = false; await exchange(b, a);
    expect(await a.read("Page.md")).toBe("# Queued\n");
  });

  test("revocation during upload prevents manifest publication", async () => {
    const remote = new MemoryStorage(), a = await copy(remote);
    await a.save("Page.md", "# Private draft\n");
    remote.afterWrite = async (path) => { if (path.includes("/objects/")) a.access.denied = true; };
    expect((await a.sync.sync(a.wiki.id)).state).toBe("error");
    expect(await remote.stat(manifestPath)).toBeNull();
    expect(await a.read("Page.md")).toBe("# Private draft\n");
  });

  test("invalid manifests, unsafe paths, and corrupt remote objects never replace local pages", async () => {
    const remote = new MemoryStorage(), a = await copy(remote), b = await copy(remote);
    await a.save("Page.md", "# Original\n"); await exchange(a, b);
    const originalManifest = await remote.read(manifestPath);
    await remote.write(manifestPath, Buffer.from("---\nversion: broken\n---\n"), "text/markdown", { version: originalManifest.version });
    expect((await b.sync.sync(b.wiki.id)).state).toBe("error");
    expect(await b.read("Page.md")).toBe("# Original\n");
    const unsafe = buildFrontmatter({ version: 1, files: [{ path: "../outside.md", hash: "a".repeat(64), size: 5 }] });
    await remote.write(manifestPath, Buffer.from(unsafe), "text/markdown", {});
    expect((await b.sync.sync(b.wiki.id)).state).toBe("error");
    await remote.write(manifestPath, originalManifest.data, "text/markdown", {});
    await a.save("Page.md", "# Remote update\n"); await a.sync.sync(a.wiki.id);
    const pointer = [...remote.files.keys()].find((path) => path.includes("/objects/") && remote.files.get(path)?.data.toString() === "# Remote update\n");
    expect(pointer).toBeDefined();
    await remote.write(pointer!, Buffer.from("Unverified"), "text/markdown", {});
    expect((await b.sync.sync(b.wiki.id)).state).toBe("error");
    expect(await b.read("Page.md")).toBe("# Original\n");
  });

  test("an oversized external Markdown page fails before publishing a partial collection", async () => {
    const remote = new MemoryStorage(), a = await copy(remote);
    await a.save("Valid.md", "# Valid\n");
    await writeFile(join(a.wiki.root, "Oversized.md"), "x".repeat(2 * 1024 * 1024 + 1));
    expect((await a.sync.sync(a.wiki.id)).state).toBe("error");
    expect(await remote.stat(manifestPath)).toBeNull();
    expect(await a.read("Valid.md")).toBe("# Valid\n");
  });

  test("automatic polling captures external file saves, and corrupted local state fails safely", async () => {
    const remote = new MemoryStorage(), a = await copy(remote);
    a.sync.start();
    await writeFile(join(a.wiki.root, "External.md"), "# External editor\n");
    for (let i = 0; i < 50 && !remote.files.has(manifestPath); i++) await new Promise((done) => setTimeout(done, 20));
    expect(remote.files.has(manifestPath)).toBe(true);
    const b = await copy(remote); await b.sync.sync(b.wiki.id);
    expect(await b.read("External.md")).toBe("# External editor\n");
    await a.sync.stop();
    const state = join(a.root, "wiki-sync", `${a.wiki.id}.md`);
    expect(parseFrontmatter(await readFile(state, "utf8")).data).toHaveProperty("binding");
    await writeFile(state, "broken: local sync state");
    await a.save("External.md", "# Retained\n");
    expect((await a.sync.sync(a.wiki.id)).state).toBe("error");
    expect(await a.read("External.md")).toBe("# Retained\n");
  });
});
