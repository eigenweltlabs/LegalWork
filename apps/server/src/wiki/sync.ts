import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { WikiRegistration, WikiSyncStatus } from "@legalwork/types/wiki";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";
import { parseFrontmatter, buildFrontmatter } from "../frontmatter.js";
import { StorageStore, type StoredStorage } from "../file-storage/store.js";
import { TeamStorage, isTeamStorage } from "../file-storage/team.js";
import { StorageOAuth } from "../file-storage/oauth/session.js";
import { withStorage } from "../file-storage/service.js";
import { storagePath, type StorageAdapter } from "../file-storage/common.js";
import { mergeText, mergeableText, MERGEABLE_TEXT_MAX_BYTES } from "./text-merge.js";
import type { WikiStore } from "./store.js";

const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const entrySchema = z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0).max(100 * 1024 * 1024) });
type SyncedFile = z.infer<typeof entrySchema>;
const manifestSchema = z.object({ version: z.literal(1), files: z.array(entrySchema).max(50_000) });
const baseSchema = z.object({ binding: z.string(), files: z.array(entrySchema.extend({ text: z.string().optional() })).max(50_000) });
type SyncBase = z.infer<typeof baseSchema>;
type Store = Pick<WikiStore, "list" | "get" | "files" | "readAsset" | "writeAsset" | "remove">;
type StorageAccess = { readOnly: boolean; run: <T>(fn: (adapter: StorageAdapter) => Promise<T>) => Promise<T> };
type Options = { storage?: (wiki: WikiRegistration) => Promise<StorageAccess>; intervalMs?: number };
const localStatus = (): WikiSyncStatus => ({ state: "local", lastSyncedAt: null, error: null, conflicts: [] });

/**
 * Saved files sync automatically. An atomic, conditional Markdown manifest
 * publishes immutable file revisions together. A failed upload cannot publish
 * half a wiki, and a second computer cannot overwrite a manifest it never read.
 * Local folders remain ordinary Markdown files, usable by any editor or agent.
 */
export class WikiSync {
  private statuses = new Map<string, WikiSyncStatus>();
  private pending = new Map<string, Promise<WikiSyncStatus>>();
  private scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  private hashes = new Map<string, { size: number; updatedAt: number; changedAt: number | undefined; hash: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private storageStore: StorageStore;
  private team: TeamStorage;
  private oauth: StorageOAuth;
  private stateDirectory: string;
  constructor(private config: ServerConfig, private store: Store, private options: Options = {}) {
    this.storageStore = new StorageStore(config);
    this.team = new TeamStorage(config);
    this.oauth = new StorageOAuth(join(dirname(this.storageStore.path), "storage-oauth.vault"));
    this.stateDirectory = join(config.configPath ? dirname(resolve(config.configPath)) : join(homedir(), ".config", "legalwork"), "wiki-sync");
  }
  status(id: string): WikiSyncStatus { return this.statuses.get(id) ?? localStatus(); }
  start() {
    const tick = async () => {
      if (this.stopped) return;
      try {
        for (const wiki of await this.store.list()) {
          if (this.stopped) return;
          if (wiki.sync) void this.sync(wiki.id);
        }
      } catch { /* A damaged registry is reported by the wiki API, not a timer. */ }
    };
    this.timer = setInterval(() => void tick(), this.options.intervalMs ?? 15_000);
    this.timer.unref?.();
    void tick();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const timer of this.scheduled.values()) clearTimeout(timer);
    this.scheduled.clear();
    await Promise.allSettled(this.pending.values());
  }
  changed(id: string) {
    if (this.stopped) return;
    const previous = this.scheduled.get(id);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => { this.scheduled.delete(id); void this.sync(id); }, 350);
    timer.unref?.();
    this.scheduled.set(id, timer);
  }
  private async access(wiki: WikiRegistration): Promise<StorageAccess> {
    if (this.options.storage) return this.options.storage(wiki);
    if (!wiki.sync) throw new ApiError(400, "wiki_not_shared", "This wiki is local.");
    const { workspaceId, connectionId } = wiki.sync;
    let connection: StoredStorage | undefined;
    if (isTeamStorage(connectionId)) {
      const shared = await this.team.list(workspaceId, true);
      connection = shared.connections.find((item) => item.id === connectionId);
      if (!connection) throw new ApiError(503, "wiki_team_unavailable", shared.status.error ?? "The team storage connection is unavailable. Local changes are retained.");
    } else connection = await this.storageStore.get(workspaceId, connectionId);
    if (!connection.enabled || connection.team?.installed === false) throw new ApiError(403, "wiki_storage_disabled", "Enable and install this wiki's storage connection.");
    // These protocols have no cross-client conditional write. They remain source
    // connectors; publishing a shared manifest needs a versioned provider.
    if (["smb", "ftp", "sftp"].includes(connection.config.kind)) throw new ApiError(400, "wiki_sync_unsupported", "Shared wikis need versioned storage: S3, Azure, Google Cloud, WebDAV, Dropbox, or Box.");
    this.oauth.bind(workspaceId, connectionId, connection);
    const input = connection;
    return { readOnly: input.readOnly || this.config.readOnly, run: (fn) => withStorage(input, fn) };
  }
  async ensureWritable(wiki: WikiRegistration, allowOffline = false) {
    if (this.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
    if (!wiki.sync) return;
    try {
      if ((await this.access(wiki)).readOnly) throw new ApiError(403, "wiki_read_only", "This shared wiki is read-only.");
    } catch (error) {
      // The owner already owns the local files. Offline edits may queue, but
      // publication always obtains a fresh authorized storage lease.
      if (allowOffline && error instanceof ApiError && (error.status >= 500 || error.status === 401)) return;
      throw error;
    }
  }
  async ensureReadable(wiki: WikiRegistration) { if (wiki.sync) await this.access(wiki); }
  async sync(id: string): Promise<WikiSyncStatus> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    const run = this.perform(id).catch((error: unknown) => {
      const previous = this.status(id);
      const next: WikiSyncStatus = { ...previous, state: "error", error: error instanceof Error ? error.message : "Wiki sync failed. Local files are retained." };
      this.statuses.set(id, next);
      return next;
    });
    this.pending.set(id, run);
    try { return await run; }
    finally { if (this.pending.get(id) === run) this.pending.delete(id); }
  }
  private statePath(id: string) { return join(this.stateDirectory, `${id}.md`); }
  private async loadBase(id: string, binding: string): Promise<SyncBase> {
    try {
      const parsed = baseSchema.parse(parseFrontmatter(await readFile(this.statePath(id), "utf8")).data);
      return parsed.binding === binding ? parsed : { binding, files: [] };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { binding, files: [] };
      throw new ApiError(500, "wiki_sync_state_invalid", "Wiki sync state could not be read. No files were changed.");
    }
  }
  private async saveBase(id: string, base: SyncBase) {
    await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
    const temp = `${this.statePath(id)}.${randomUUID()}.tmp`;
    await writeFile(temp, buildFrontmatter(base) + "\n# Local wiki sync state\n", { mode: 0o600 });
    await rename(temp, this.statePath(id));
  }
  private async perform(id: string): Promise<WikiSyncStatus> {
    const wiki = await this.store.get(id);
    if (!wiki.sync) { const status = localStatus(); this.statuses.set(id, status); return status; }
    const access = await this.access(wiki);
    const syncSettings = wiki.sync;
    const prefix = storagePath(syncSettings.path.replace(/\/+$/, ""), false);
    const binding = JSON.stringify(syncSettings);
    const base = await this.loadBase(id, binding);
    this.statuses.set(id, { ...this.status(id), state: "syncing", error: null });
    const result = await access.run(async (remote) => {
      const manifestPath = `${prefix}/.legalwork-wiki/Manifest.md`;
      const manifestInfo = await remote.stat(manifestPath);
      let remoteFiles: SyncedFile[] = [];
      let version: string | undefined;
      if (manifestInfo) {
        if (manifestInfo.size > 16 * 1024 * 1024) throw new ApiError(413, "wiki_manifest_too_large", "The shared wiki index is too large.");
        const data = await remote.read(manifestPath);
        const manifest = manifestSchema.safeParse(parseFrontmatter(data.data.toString("utf8")).data);
        if (!manifest.success) throw new ApiError(502, "wiki_manifest_invalid", "The shared wiki index is invalid. No files were changed.");
        remoteFiles = manifest.data.files;
        version = data.version;
        if (!version) throw new ApiError(400, "wiki_version_required", "This storage provider did not supply a file revision.");
      }
      const validPaths = new Set<string>();
      for (const file of remoteFiles) {
        storagePath(file.path, false);
        if (file.path.split("/").some((part) => part.startsWith(".")) || validPaths.has(file.path.toLowerCase()) || (/\.md$/i.test(file.path) && file.size > MERGEABLE_TEXT_MAX_BYTES)) throw new ApiError(502, "wiki_manifest_invalid", "The shared wiki contains invalid, oversized, or duplicate page paths.");
        validPaths.add(file.path.toLowerCase());
      }
      const objects = (file: SyncedFile) => `${prefix}/.legalwork-wiki/objects/${file.hash}/${file.path}`;
      const fetched = new Map<string, Buffer>();
      const fetchRemote = async (file: SyncedFile) => {
        const cached = fetched.get(file.path);
        if (cached) return cached;
        const data = await remote.read(objects(file));
        if (data.data.byteLength !== file.size || hash(data.data) !== file.hash) throw new ApiError(502, "wiki_object_invalid", `The shared revision of ${file.path} could not be verified.`);
        fetched.set(file.path, data.data);
        return data.data;
      };
      const locals = new Map<string, { file: SyncedFile }>();
      for (const file of await this.store.files(id)) {
        if (/\.md$/i.test(file.path) && file.size > MERGEABLE_TEXT_MAX_BYTES) throw new ApiError(413, "wiki_file_too_large", `${file.path} exceeds the 2 MB Markdown page limit. Local files are retained.`);
        const key = `${id}:${file.path}`, cached = this.hashes.get(key);
        const unchanged = file.changedAt !== undefined && cached?.size === file.size && cached.updatedAt === file.updatedAt && cached.changedAt === file.changedAt;
        const sha = unchanged ? cached.hash : hash(await this.store.readAsset(id, file.path));
        this.hashes.set(key, { size: file.size, updatedAt: file.updatedAt, changedAt: file.changedAt, hash: sha });
        locals.set(file.path, { file: { path: file.path, hash: sha, size: file.size } });
      }
      const localData = async (file: SyncedFile) => {
        const data = await this.store.readAsset(id, file.path);
        if (hash(data) !== file.hash) throw new ApiError(409, "wiki_changed_during_sync", `${file.path} changed during sync. Its newer edits will sync on the next round.`);
        return data;
      };
      const agreed = new Map(base.files.map((file) => [file.path, file]));
      const theirs = new Map(remoteFiles.map((file) => [file.path, file]));
      const next = new Map(theirs);
      const uploads = new Map<string, { file: SyncedFile; data?: Buffer; source?: SyncedFile }>();
      const placements: Array<{ path: string; file: SyncedFile | null; expected: string; data?: Buffer }> = [];
      const conflicts: string[] = [];
      const keys = new Set([...locals.keys(), ...theirs.keys(), ...agreed.keys()]);
      for (const path of keys) {
        const mine = locals.get(path);
        const their = theirs.get(path);
        const previous = agreed.get(path);
        const mineHash = mine?.file.hash ?? null;
        const theirHash = their?.hash ?? null;
        const baseHash = previous?.hash ?? null;
        if (mineHash === theirHash) continue;
        if (mineHash === baseHash) { placements.push({ path, file: their ?? null, expected: mineHash ?? "" }); continue; }
        if (theirHash === baseHash) {
          if (mine) { next.set(path, mine.file); uploads.set(path, mine); }
          else next.delete(path);
          continue;
        }
        if (mine && their && previous?.text !== undefined && mergeableText(path) && mine.file.size <= MERGEABLE_TEXT_MAX_BYTES && their.size <= MERGEABLE_TEXT_MAX_BYTES) {
          const merged = mergeText(previous.text, (await localData(mine.file)).toString("utf8"), (await fetchRemote(their)).toString("utf8"));
          if (merged !== null) {
            const data = Buffer.from(merged);
            const file = { path, hash: hash(data), size: data.byteLength };
            next.set(path, file); uploads.set(path, { file, data });
            placements.push({ path, file, data, expected: mine.file.hash });
            continue;
          }
        }
        // Preserve both conflicting edits as ordinary files. The remote keeps
        // its name; this computer's differing version gets a stable copy name.
        conflicts.push(path);
        if (mine && their) {
          const extension = path.match(/\.[^/.]+$/)?.[0] ?? "";
          const copy = `${path.slice(0, path.length - extension.length)}.conflict-${mine.file.hash.slice(0, 12)}${extension}`;
          const file = { ...mine.file, path: copy };
          const data = await localData(mine.file);
          next.set(copy, file); uploads.set(copy, { file, data });
          placements.push({ path: copy, file, data, expected: locals.get(copy)?.file.hash ?? "" });
          placements.push({ path, file: their, expected: mine.file.hash });
        } else if (their) placements.push({ path, file: their, expected: "" });
        else if (mine) { next.set(path, mine.file); uploads.set(path, mine); }
      }
      const changed = uploads.size > 0 || next.size !== theirs.size;
      if (next.size > 50_000) throw new ApiError(413, "wiki_too_many_files", "A shared wiki supports up to 50,000 files. Split this collection into another wiki.");
      if (changed && access.readOnly) throw new ApiError(403, "wiki_read_only", "This shared wiki is read-only. Local changes are retained.");
      const directories = new Set<string>();
      const ensureDirectories = async (path: string) => {
        const parts = path.split("/").slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          const directory = parts.slice(0, i).join("/");
          if (directories.has(directory)) continue;
          await remote.mkdir(directory);
          directories.add(directory);
        }
      };
      if (changed) {
        for (const upload of uploads.values()) {
          const { file } = upload;
          const data = upload.data ?? await localData(upload.source ?? file);
          const target = objects(file);
          if (!await remote.stat(target)) {
            await ensureDirectories(target);
            try { await remote.write(target, data, mergeableText(file.path) ? "text/markdown;charset=utf-8" : "application/octet-stream", { createOnly: true }); }
            catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
          }
        }
        // A fresh lease checks revocation after uploads, before publication.
        await this.ensureWritable(wiki);
        await ensureDirectories(manifestPath);
        const manifest = buildFrontmatter({ version: 1, files: [...next.values()].sort((a, b) => a.path.localeCompare(b.path)) }) + "\n# Shared wiki revisions\n\nEach entry points to an immutable file revision. Local folders contain the current Markdown pages.\n";
        if (Buffer.byteLength(manifest) > 16 * 1024 * 1024) throw new ApiError(413, "wiki_manifest_too_large", "The shared wiki index is too large. Split this collection into another wiki.");
        await remote.write(manifestPath, Buffer.from(manifest), "text/markdown;charset=utf-8", version === undefined ? { createOnly: true } : { version });
      }
      const stale = new Set<string>();
      // Place downloads only after a successful publication. Each local write
      // names its base, so a save made during the transfer survives for retry.
      for (const placement of placements) {
        try {
          if (placement.file) await this.store.writeAsset(id, placement.path, placement.data ?? await fetchRemote(placement.file), placement.expected);
          else if (placement.expected) await this.store.remove(id, placement.path, placement.expected);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
          stale.add(placement.path);
        }
        if (placement.file && !mergeableText(placement.path)) fetched.delete(placement.path);
      }
      const saved: SyncBase = { binding, files: [] };
      for (const file of next.values()) {
        if (stale.has(file.path)) {
          const previous = agreed.get(file.path);
          if (previous) saved.files.push(previous);
          continue;
        }
        let content = uploads.get(file.path)?.data ?? fetched.get(file.path);
        const previous = agreed.get(file.path);
        if (!content && previous?.hash === file.hash && previous.text !== undefined) content = Buffer.from(previous.text);
        if (!content && mergeableText(file.path) && file.size <= MERGEABLE_TEXT_MAX_BYTES) {
          const local = locals.get(file.path);
          if (local?.file.hash === file.hash) content = await this.store.readAsset(id, file.path);
        }
        const text = content && hash(content) === file.hash && mergeableText(file.path) && content.byteLength <= MERGEABLE_TEXT_MAX_BYTES ? content.toString("utf8") : undefined;
        saved.files.push({ ...file, ...(text !== undefined ? { text } : {}) });
      }
      // Keep deleted bases if a newer local save prevented a remote deletion.
      for (const path of stale) if (!next.has(path) && agreed.has(path)) saved.files.push(agreed.get(path)!);
      await this.saveBase(id, saved);
      const conflictCopies = [...next.keys()].filter((path) => /\.conflict-[a-f0-9]{12}(?:\.|$)/.test(path));
      return { state: "idle", lastSyncedAt: Date.now(), error: null, conflicts: [...new Set([...conflicts, ...conflictCopies])] } satisfies WikiSyncStatus;
    });
    this.statuses.set(id, result);
    return result;
  }
}
