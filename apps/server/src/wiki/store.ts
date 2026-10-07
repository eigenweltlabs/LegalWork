import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { WikiAsset, WikiCreateInput, WikiDocument, WikiRegistration, WikiRevision, WikiSnapshot, WikiSyncStatus, WikiUpdateInput, WikiView } from "@legalwork/types/wiki";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";
import { workspaceIdForPath } from "../workspaces.js";
import { markdownData, markdownWithData, parseWikiPage, parseWikiViews, resolveWikiLinks } from "./markdown.js";
import { createWikiStarterFiles } from "./templates.js";
import { assertWikiFoldersIndependent, canonicalFolderPath } from "./workspace-safety.js";

export const WIKI_MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const WIKI_MAX_ASSET_BYTES = 100 * 1024 * 1024;
const legacySyncSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  connectionId: z.string().min(1).max(200),
  path: z.string().min(1).max(4096).refine(isWikiPath, "Use a dedicated relative folder path."),
});
export const wikiTeamSyncSchema = z.object({ kind: z.literal("team"), wikiId: z.string().uuid(), orgId: z.string().min(1).max(200) });
export const wikiSyncSchema = z.union([wikiTeamSyncSchema, legacySyncSchema]);
const registrationSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(200), root: z.string().min(1),
  workspaceId: z.string().min(1), allowInProjects: z.boolean(), projectWorkspaceIds: z.array(z.string().min(1).max(200)).max(1000).nullable().optional(), sync: wikiSyncSchema.nullable(),
});
const indexRowSchema = z.object({
  path: z.string(), content: z.string(), revision: z.string(), mtime: z.number(), ctime: z.number(),
  size: z.number(), updatedAt: z.number(), warning: z.string().nullable(),
});
type IndexedPage = Omit<z.infer<typeof indexRowSchema>, "warning"> & ReturnType<typeof parseWikiPage>;
type SqlValue = string | number | null;
type Sqlite = { run(sql: string, values?: SqlValue[]): void; all(sql: string, values?: SqlValue[]): unknown[]; close(): void; exec(sql: string): void };
const pending = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  pending.set(key, operation);
  try { return await operation; } finally { if (pending.get(key) === operation) pending.delete(key); }
}
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

export function isWikiPath(path: string): boolean {
  return Boolean(path) && path.length <= 4096 && !isAbsolute(path) && !/[\\\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."));
}
export function wikiPath(path: string): string {
  if (!isWikiPath(path)) throw new ApiError(400, "invalid_wiki_path", "Use a relative path without hidden files, traversal, or backslashes.");
  return path;
}
const isMarkdown = (path: string) => /\.md$/i.test(path);

async function openSqlite(path: string): Promise<Sqlite> {
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, { create: true });
    return { run: (sql, values = []) => { db.query(sql).run(...values); }, all: (sql, values = []) => db.query(sql).all(...values), exec: (sql) => { db.exec(sql); }, close: () => db.close() };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return { run: (sql, values = []) => { db.prepare(sql).run(...values); }, all: (sql, values = []) => db.prepare(sql).all(...values), exec: (sql) => { db.exec(sql); }, close: () => db.close() };
}

/** Portable authored files live in the wiki. Registration, cache and durable history stay on this host. */
export class WikiStore {
  readonly path: string;
  readonly baseDir: string;
  private readonly config: ServerConfig;
  private database: Promise<Sqlite> | undefined;
  private readonly indexes = new Map<string, Map<string, IndexedPage>>();

  constructor(config: ServerConfig) {
    this.config = config;
    this.baseDir = config.configPath ? dirname(resolve(config.configPath)) : join(homedir(), ".config", "legalwork");
    this.path = join(this.baseDir, "wikis.md");
  }
  private async db(): Promise<Sqlite> {
    if (!this.database) this.database = (async () => {
      await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
      const databasePath = join(this.baseDir, "wiki-state.sqlite");
      const db = await openSqlite(databasePath);
      await chmod(databasePath, 0o600);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS wiki_pages (wiki TEXT NOT NULL,path TEXT NOT NULL,content TEXT NOT NULL,revision TEXT NOT NULL,mtime REAL NOT NULL,ctime REAL NOT NULL,size INTEGER NOT NULL,updatedAt REAL NOT NULL,warning TEXT, PRIMARY KEY(wiki,path));
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(wiki UNINDEXED,path UNINDEXED,title,body);
        CREATE TABLE IF NOT EXISTS wiki_history (id TEXT PRIMARY KEY,wiki TEXT NOT NULL,path TEXT NOT NULL,createdAt REAL NOT NULL,action TEXT NOT NULL,size INTEGER NOT NULL,content TEXT NOT NULL,revision TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS wiki_folders (root TEXT PRIMARY KEY,id TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS wiki_history_path ON wiki_history(wiki,path,createdAt DESC);`);
      return db;
    })();
    return this.database;
  }
  async close(): Promise<void> { if (this.database) (await this.database).close(); this.database = undefined; this.indexes.clear(); }

  private registerWorkspace(wiki: WikiRegistration): void {
    if (!this.config.workspaces.some((workspace) => workspace.id === wiki.workspaceId)) {
      this.config.workspaces.push({ id: wiki.workspaceId, name: wiki.name, path: wiki.root, preset: "wiki", workspaceType: "local" });
    }
    if (!this.config.authorizedRoots.includes(wiki.root)) this.config.authorizedRoots.push(wiki.root);
  }
  async list(): Promise<WikiRegistration[]> {
    try {
      const content = await readFile(this.path, "utf8");
      const { data, warning } = markdownData(content);
      if (warning) throw new Error(warning);
      const items = z.array(registrationSchema).parse(data.wikis ?? []);
      await assertWikiFoldersIndependent(items, this.config.workspaces);
      for (const wiki of items) this.registerWorkspace(wiki);
      return items;
    } catch (error) {
      if (missing(error)) return [];
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "wiki_registry_unreadable", "The saved wiki registry could not be read. Check wikis.md in the LegalWork configuration folder.");
    }
  }
  async get(id: string): Promise<WikiRegistration> {
    const wiki = (await this.list()).find((item) => item.id === id);
    if (!wiki) throw new ApiError(404, "wiki_not_found", "This wiki is no longer registered on this server.");
    return wiki;
  }
  private async saveRegistrations(items: WikiRegistration[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    let original = "# Wikis\n\nThis file registers wiki folders on this computer. The content remains in those folders.\n";
    try { original = await readFile(this.path, "utf8"); } catch (error) { if (!missing(error)) throw error; }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, markdownWithData(original, { wikis: items }), { mode: 0o600 });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
  async create(input: WikiCreateInput): Promise<WikiRegistration> {
    return serial(this.path, async () => {
      const name = input.name.trim();
      if (!name || name.length > 200) throw new ApiError(400, "invalid_wiki_name", "Give the wiki a name of at most 200 characters.");
      const items = await this.list(), newId = randomUUID();
      const root = resolve(input.root?.trim() || join(this.baseDir, "wikis", newId));
      if (root === this.baseDir || this.baseDir.startsWith(`${root}${sep}`)) throw new ApiError(400, "invalid_wiki_root", "Choose a content folder outside the LegalWork configuration files.");
      if (items.some((wiki) => root === wiki.root || root.startsWith(`${wiki.root}${sep}`) || wiki.root.startsWith(`${root}${sep}`))) {
        throw new ApiError(409, "wiki_root_registered", "This folder, or a containing folder, is already a wiki.");
      }
      const pendingRoot = await canonicalFolderPath(root);
      await assertWikiFoldersIndependent([...items, { id: newId, name, root: pendingRoot, workspaceId: workspaceIdForPath(pendingRoot), allowInProjects: true, sync: input.sync ?? null }], this.config.workspaces);
      await mkdir(root, { recursive: true });
      if ((await lstat(root)).isSymbolicLink()) throw new ApiError(403, "unsafe_wiki_path", "Wiki folders cannot be symbolic links.");
      const canonicalRoot = await realpath(root);
      await this.safeRoot(canonicalRoot);
      if (items.some((wiki) => canonicalRoot === wiki.root)) throw new ApiError(409, "wiki_root_registered", "This folder is already a wiki.");
      const db = await this.db();
      const knownFolder = z.object({ id: z.string().uuid() }).optional().parse(db.all("SELECT id FROM wiki_folders WHERE root=?", [canonicalRoot])[0]);
      const id = knownFolder?.id ?? newId;
      db.run("INSERT OR REPLACE INTO wiki_folders(root,id) VALUES(?,?)", [canonicalRoot, id]);
      const wiki: WikiRegistration = { id, name, root: canonicalRoot, workspaceId: workspaceIdForPath(canonicalRoot), allowInProjects: true, sync: input.sync ?? null };
      for (const [path, content] of Object.entries(input.attach ? {} : createWikiStarterFiles(input.template ?? "blank", name))) {
        const target = await this.safePath(wiki, path, true);
        try { await writeFile(target, path === "Wiki.md" ? markdownWithData(content, { name }) : content, { flag: "wx" }); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
      }
      await this.saveRegistrations([...items, wiki]);
      this.registerWorkspace(wiki);
      return wiki;
    });
  }
  async update(id: string, input: WikiUpdateInput): Promise<WikiRegistration> {
    return serial(this.path, async () => {
      const items = await this.list(), current = items.find((item) => item.id === id);
      if (!current) throw new ApiError(404, "wiki_not_found", "This wiki is no longer registered.");
      const parsed = registrationSchema.safeParse({ ...current, ...input, name: input.name?.trim() ?? current.name });
      if (!parsed.success) throw new ApiError(400, "invalid_wiki_configuration", "Check the wiki name and sync settings.");
      const wiki = parsed.data;
      await this.saveRegistrations(items.map((item) => item.id === id ? wiki : item));
      const workspace = this.config.workspaces.find((item) => item.id === wiki.workspaceId);
      if (workspace?.preset === "wiki") workspace.name = wiki.name;
      return wiki;
    });
  }
  /** Forgetting a folder never deletes its content or its recovery history. */
  async forget(id: string): Promise<void> {
    await serial(this.path, async () => {
      const items = await this.list(), wiki = items.find((item) => item.id === id);
      if (!wiki) throw new ApiError(404, "wiki_not_found", "This wiki is no longer registered.");
      await this.saveRegistrations(items.filter((item) => item.id !== id));
      this.config.workspaces = this.config.workspaces.filter((item) => item.id !== wiki.workspaceId || item.preset !== "wiki");
      this.indexes.delete(id);
    });
  }

  private async safeRoot(root: string): Promise<void> {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(root) !== root) throw new ApiError(403, "unsafe_wiki_path", "Wiki folders cannot follow symbolic links.");
  }
  private async safePath(wiki: WikiRegistration, path: string, createParents = false): Promise<string> {
    wikiPath(path);
    await this.safeRoot(wiki.root);
    let current = wiki.root;
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) throw new ApiError(403, "unsafe_wiki_path", "Wiki paths cannot follow symbolic links or files used as folders.");
      } catch (error) {
        if (!missing(error)) throw error;
        if (createParents && index < parts.length - 1) await mkdir(current, { recursive: false });
      }
    }
    const parent = await realpath(dirname(current)).catch((error: unknown) => { if (!missing(error)) throw error; return dirname(current); });
    if (parent !== wiki.root && !parent.startsWith(`${wiki.root}${sep}`)) throw new ApiError(403, "unsafe_wiki_path", "Wiki files must remain inside the wiki folder.");
    return current;
  }
  private async fileBytes(wiki: WikiRegistration, path: string, maximum: number): Promise<Buffer> {
    const target = await this.safePath(wiki, path);
    let file;
    try { file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (missing(error)) throw new ApiError(404, "wiki_file_not_found", "This wiki file no longer exists."); throw error; }
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new ApiError(400, "invalid_wiki_file", "Choose a file in the wiki.");
      if (info.size > maximum) throw new ApiError(413, "wiki_file_too_large", `This file exceeds the ${Math.floor(maximum / 1024 / 1024)} MB limit.`);
      return await file.readFile();
    } finally { await file.close(); }
  }
  private async inventory(wiki: WikiRegistration): Promise<{ files: WikiAsset[]; warnings: string[] }> {
    await this.safeRoot(wiki.root);
    const files: WikiAsset[] = [], warnings: string[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) { warnings.push("Folders deeper than 32 levels were skipped."); return; }
      const canonical = await realpath(directory);
      if (canonical !== directory || (canonical !== wiki.root && !canonical.startsWith(`${wiki.root}${sep}`))) throw new ApiError(403, "unsafe_wiki_path", "Wiki folders cannot follow symbolic links.");
      if (files.length >= 20_000) throw new ApiError(413, "wiki_too_many_files", "A wiki can index up to 20,000 files. Split this folder into smaller wikis.");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const absolute = join(directory, entry.name), path = relative(wiki.root, absolute).split(sep).join("/");
        if (entry.isSymbolicLink()) { warnings.push(`${path}: symbolic links are skipped.`); continue; }
        if (!isWikiPath(path)) { warnings.push(`${path}: unsupported filename.`); continue; }
        if (entry.isDirectory()) { await walk(absolute, depth + 1); continue; }
        if (!entry.isFile()) continue;
        try {
          const info = await lstat(absolute);
          if (info.isSymbolicLink() || !info.isFile()) continue;
          if (files.length >= 20_000) throw new ApiError(413, "wiki_too_many_files", "A wiki can index up to 20,000 files.");
          files.push({ path, size: info.size, updatedAt: info.mtimeMs, changedAt: info.ctimeMs });
        } catch (error) { if (!missing(error)) throw error; }
      }
    };
    await walk(wiki.root, 0);
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), warnings };
  }
  async files(id: string): Promise<WikiAsset[]> { return (await this.inventory(await this.get(id))).files; }
  private async index(id: string): Promise<Map<string, IndexedPage>> {
    let index = this.indexes.get(id);
    if (!index) {
      index = new Map();
      const rows = await this.db();
      for (const raw of rows.all("SELECT path,content,revision,mtime,ctime,size,updatedAt,warning FROM wiki_pages WHERE wiki=?", [id])) {
        const row = indexRowSchema.parse(raw), parsed = parseWikiPage(row.path, row.content, row.revision, row.updatedAt);
        index.set(row.path, { ...row, ...parsed, warning: parsed.warning });
      }
      this.indexes.set(id, index);
    }
    return index;
  }
  private async record(id: string, path: string, content: string, action: WikiRevision["action"]): Promise<void> {
    const db = await this.db(), revision = hash(content);
    const latest = z.object({ action: z.string(), revision: z.string() }).optional().parse(db.all("SELECT action,revision FROM wiki_history WHERE wiki=? AND path=? ORDER BY createdAt DESC,rowid DESC LIMIT 1", [id, path])[0]);
    if (latest?.revision === revision && (latest.action === action || (action === "write" && latest.action !== "delete"))) return;
    db.run("INSERT INTO wiki_history(id,wiki,path,createdAt,action,size,content,revision) VALUES(?,?,?,?,?,?,?,?)", [randomUUID(), id, path, Date.now(), action, Buffer.byteLength(content), content, revision]);
  }
  private async remember(id: string, path: string, content: string, knownWiki?: WikiRegistration, knownFile?: WikiAsset): Promise<IndexedPage> {
    const wiki = knownWiki ?? await this.get(id);
    const info = knownFile ? { mtimeMs: knownFile.updatedAt, ctimeMs: knownFile.changedAt ?? knownFile.updatedAt, size: knownFile.size } : await stat(await this.safePath(wiki, path));
    const revision = hash(content), parsed = parseWikiPage(path, content, revision, info.mtimeMs);
    const row: IndexedPage = { path, content, revision, mtime: info.mtimeMs, ctime: info.ctimeMs, size: info.size, updatedAt: info.mtimeMs, ...parsed };
    const db = await this.db();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.run("INSERT OR REPLACE INTO wiki_pages(wiki,path,content,revision,mtime,ctime,size,updatedAt,warning) VALUES(?,?,?,?,?,?,?,?,?)", [id, path, content, revision, row.mtime, row.ctime, row.size, row.updatedAt, parsed.warning ?? null]);
      db.run("DELETE FROM wiki_search WHERE wiki=? AND path=?", [id, path]);
      db.run("INSERT INTO wiki_search(wiki,path,title,body) VALUES(?,?,?,?)", [id, path, parsed.page.title, content]);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    (await this.index(id)).set(path, row);
    return row;
  }
  private async drop(id: string, path: string): Promise<void> {
    const db = await this.db();
    db.run("DELETE FROM wiki_pages WHERE wiki=? AND path=?", [id, path]);
    db.run("DELETE FROM wiki_search WHERE wiki=? AND path=?", [id, path]);
    (await this.index(id)).delete(path);
  }
  private async refresh(id: string): Promise<{ files: WikiAsset[]; warnings: string[] }> {
    const wiki = await this.get(id), inventory = await this.inventory(wiki), index = await this.index(id);
    const existing = new Set<string>();
    for (const file of inventory.files) {
      if (!isMarkdown(file.path)) continue;
      existing.add(file.path);
      if (file.size > WIKI_MAX_PAGE_BYTES) {
        inventory.warnings.push(`${file.path}: exceeds the 2 MB Markdown limit.`);
        if (index.has(file.path)) await this.drop(id, file.path);
        continue;
      }
      const current = index.get(file.path);
      if (current && current.mtime === file.updatedAt && current.ctime === file.changedAt && current.size === file.size) continue;
      const content = (await this.fileBytes(wiki, file.path, WIKI_MAX_PAGE_BYTES)).toString("utf8");
      if (current && current.revision !== hash(content)) await this.record(id, file.path, current.content, "write");
      await this.record(id, file.path, content, "write");
      await this.remember(id, file.path, content, wiki, file);
    }
    for (const [path, cached] of index) if (!existing.has(path)) {
      await this.record(id, path, cached.content, "delete");
      await this.drop(id, path);
    }
    return inventory;
  }
  async snapshot(id: string): Promise<WikiSnapshot> {
    return serial(`${this.path}:${id}`, async () => {
      const wiki = await this.get(id), { files, warnings } = await this.refresh(id);
      const index = await this.index(id), pages = resolveWikiLinks([...index.values()].map((row) => row.page));
      for (const row of index.values()) if (row.warning) warnings.push(`${row.path}: ${row.warning}`);
      const views: { views: WikiView[]; warnings: string[] } = { views: [], warnings: [] };
      const names = new Set<string>();
      for (const row of index.values()) if (row.path === "Views.md" || row.page.properties.views !== undefined) {
        const parsed = parseWikiViews(row.content);
        views.warnings.push(...parsed.warnings.map((warning) => `${row.path}: ${warning}`));
        for (const view of parsed.views) {
          if (names.has(view.name)) { views.warnings.push(`${row.path}: duplicate view name ${view.name}.`); continue; }
          views.views.push(view);
          names.add(view.name);
        }
      }
      const syncStatus: WikiSyncStatus = { state: wiki.sync ? "idle" : "local", lastSyncedAt: null, error: null, conflicts: [] };
      return { wiki: { ...wiki, writable: !this.config.readOnly, pageCount: pages.length, totalBytes: files.reduce((total, file) => total + file.size, 0), syncStatus }, pages, assets: files.filter((file) => !isMarkdown(file.path)), views: views.views, warnings: [...warnings, ...views.warnings] };
    });
  }
  async search(id: string, query: string, type?: string) {
    const snapshot = await this.snapshot(id);
    if (!query.trim()) return snapshot.pages.filter((page) => !type || page.type === type);
    // Quote individual words so user input cannot become an FTS query program.
    const terms = query.trim().split(/\s+/).slice(0, 20).map((term) => `"${term.replace(/"/g, '""')}"*`).join(" AND ");
    const db = await this.db();
    const matches = new Set(db.all("SELECT path FROM wiki_search WHERE wiki=? AND wiki_search MATCH ? ORDER BY rank LIMIT 500", [id, terms]).map((row) => z.object({ path: z.string() }).parse(row).path));
    return snapshot.pages.filter((page) => matches.has(page.path) && (!type || page.type === type));
  }
  async read(id: string, path: string): Promise<WikiDocument> {
    wikiPath(path);
    if (!isMarkdown(path)) throw new ApiError(400, "invalid_wiki_page", "Wiki pages use the .md extension.");
    return serial(`${this.path}:${id}`, async () => {
      const wiki = await this.get(id), content = (await this.fileBytes(wiki, path, WIKI_MAX_PAGE_BYTES)).toString("utf8");
      const previous = (await this.index(id)).get(path);
      if (previous && previous.revision !== hash(content)) await this.record(id, path, previous.content, "write");
      await this.record(id, path, content, "write");
      const row = await this.remember(id, path, content);
      return { path, content, revision: row.revision, updatedAt: row.updatedAt };
    });
  }
  private conflict(baseRevision: string | undefined, current: string | null): void {
    if (baseRevision !== undefined && baseRevision !== (current ?? "")) throw new ApiError(409, "wiki_revision_conflict", "This file changed since you opened it. Reload it before saving.", { currentRevision: current });
  }
  private async atomicWrite(wiki: WikiRegistration, path: string, content: string | Buffer, expectedRevision?: string): Promise<void> {
    const target = await this.safePath(wiki, path, true), temporary = join(dirname(target), `.wiki-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: "wx" });
      await this.safePath(wiki, path);
      if (expectedRevision !== undefined) {
        let latest: Buffer | null = null;
        try { latest = await this.fileBytes(wiki, path, isMarkdown(path) ? WIKI_MAX_PAGE_BYTES : WIKI_MAX_ASSET_BYTES); }
        catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        this.conflict(expectedRevision, latest === null ? null : hash(latest));
      }
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  private async writePage(id: string, path: string, content: string, baseRevision: string | undefined, action: WikiRevision["action"]): Promise<WikiDocument> {
    wikiPath(path);
    if (!isMarkdown(path)) throw new ApiError(400, "invalid_wiki_page", "Wiki pages use the .md extension.");
    if (Buffer.byteLength(content) > WIKI_MAX_PAGE_BYTES) throw new ApiError(413, "wiki_file_too_large", "Markdown pages can contain up to 2 MB.");
    const wiki = await this.get(id);
    let previous: string | null = null;
    try { previous = (await this.fileBytes(wiki, path, WIKI_MAX_PAGE_BYTES)).toString("utf8"); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    this.conflict(baseRevision, previous === null ? null : hash(previous));
    if (previous !== null) await this.record(id, path, previous, "write");
    await this.atomicWrite(wiki, path, content, previous === null ? "" : hash(previous));
    await this.record(id, path, content, action);
    const row = await this.remember(id, path, content);
    return { path, content, revision: row.revision, updatedAt: row.updatedAt };
  }
  async write(id: string, path: string, content: string, baseRevision?: string): Promise<WikiDocument> {
    return serial(`${this.path}:${id}`, () => this.writePage(id, path, content, baseRevision, "write"));
  }
  async remove(id: string, path: string, baseRevision: string): Promise<void> {
    return serial(`${this.path}:${id}`, async () => {
      const wiki = await this.get(id), bytes = await this.fileBytes(wiki, path, isMarkdown(path) ? WIKI_MAX_PAGE_BYTES : WIKI_MAX_ASSET_BYTES);
      this.conflict(baseRevision, hash(bytes));
      if (isMarkdown(path)) await this.record(id, path, bytes.toString("utf8"), "delete");
      await rm(await this.safePath(wiki, path));
      if (isMarkdown(path)) await this.drop(id, path);
    });
  }
  async history(id: string, path = ""): Promise<WikiRevision[]> {
    if (path) wikiPath(path);
    await this.snapshot(id);
    const db = await this.db();
    const sql = `SELECT id,path,createdAt,action,size FROM wiki_history WHERE wiki=?${path ? " AND path=?" : ""} ORDER BY createdAt DESC,rowid DESC LIMIT 200`;
    return db.all(sql, path ? [id, path] : [id]).map((row) => z.object({ id: z.string(), path: z.string(), createdAt: z.number(), action: z.enum(["write", "delete", "restore"]), size: z.number() }).parse(row));
  }
  async restore(id: string, path: string, revisionId: string, baseRevision?: string): Promise<WikiDocument> {
    return serial(`${this.path}:${id}`, async () => {
      await this.get(id);
      const db = await this.db();
      const raw = db.all("SELECT content FROM wiki_history WHERE id=? AND wiki=? AND path=?", [revisionId, id, wikiPath(path)])[0];
      if (!raw) throw new ApiError(404, "wiki_revision_not_found", "This revision is unavailable for this page.");
      const row = z.object({ content: z.string() }).parse(raw);
      return this.writePage(id, path, row.content, baseRevision, "restore");
    });
  }
  async readAsset(id: string, path: string): Promise<Buffer> { return this.fileBytes(await this.get(id), path, WIKI_MAX_ASSET_BYTES); }
  async writeAsset(id: string, path: string, data: Buffer, baseRevision?: string): Promise<{ path: string }> {
    wikiPath(path);
    if (isMarkdown(path)) {
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
      catch { throw new ApiError(400, "invalid_wiki_markdown", "Markdown files must contain UTF-8 text."); }
      await this.write(id, path, content, baseRevision);
      return { path };
    }
    if (data.length > WIKI_MAX_ASSET_BYTES) throw new ApiError(413, "wiki_file_too_large", "Attachments can contain up to 100 MB.");
    await serial(`${this.path}:${id}`, async () => {
      const wiki = await this.get(id);
      let previous: Buffer | null = null;
      try { previous = await this.fileBytes(wiki, path, WIKI_MAX_ASSET_BYTES); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      this.conflict(baseRevision, previous === null ? null : hash(previous));
      await this.atomicWrite(wiki, path, data, previous === null ? "" : hash(previous));
    });
    return { path };
  }
}

export function wikiAssetContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".pdf": return "application/pdf";
    case ".html": return "text/html; charset=utf-8";
    case ".md": return "text/markdown; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}
