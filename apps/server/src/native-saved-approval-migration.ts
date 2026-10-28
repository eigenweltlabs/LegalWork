import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { canonicalFilePath, withFileWriteLock } from "./file-write-lock.js";
import { engineStorageDir } from "./engine-storage.js";
import { openSqliteReadonly } from "./managed-opencode-db.js";
import { importLegacySessionPermissionRules } from "./session-history-permissions.js";
import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const within = (root: string, path: string) => { const suffix = relative(root, path); return !suffix || !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`); };
const saved = z.object({ action: z.string().min(1), resource: z.string().min(1), createdAt: z.number().finite(), updatedAt: z.number().finite() });
export type SavedNativeApprovalMigration = {
  version: 1;
  source: string;
  sourceHash: string;
  backup: string;
  sourceRows: number;
  imports: Array<z.infer<typeof saved> & { id: string; workspaceID: string }>;
  unresolved: Array<{ sourceRow: number; reason: "unknown_project" | "shared_project" | "global_project" | "invalid_saved_policy" | "non_allow_saved_policy" }>;
};

type Snapshot = { columns: string[]; rows: Array<Record<string, unknown>>; projects: Array<Record<string, unknown>>; directories: Array<Record<string, unknown>> };
async function snapshot(path: string): Promise<Snapshot> {
  const db = await openSqliteReadonly(path);
  try {
    const tables = new Set(db.all("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
    if (!tables.has("permission")) return { columns: [], rows: [], projects: [], directories: [] };
    const columns = db.all("PRAGMA table_info(permission)").map(row => String(row.name));
    if (!columns.includes("project_id") || !columns.includes("data") && !["id", "action", "resource", "time_created", "time_updated"].every(column => columns.includes(column))) throw new Error("The existing saved-permission database has an unsupported schema; it was not changed.");
    const directories = ["worktree", "project_directory"].flatMap(table => tables.has(table) ? db.all(`SELECT project_id,directory FROM ${table}`) : []);
    return { columns, rows: db.all("SELECT * FROM permission ORDER BY project_id"), projects: tables.has("project") ? db.all("SELECT id,worktree FROM project") : [], directories };
  } finally { db.close(); }
}

/** Read-only inventory and exact private archive. No engine or app grant is
 * changed until the caller explicitly activates the prepared migration. */
export async function prepareNativeSavedApprovalMigration(config: ServerConfig, path: string): Promise<SavedNativeApprovalMigration> {
  const source = await canonicalFilePath(path), original = await snapshot(source), sourceHash = hash(original);
  const directory = join(engineStorageDir(config), "saved-permission-originals"), backup = join(directory, `${hash(source)}-${sourceHash}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const content = JSON.stringify({ version: 1, source, sourceHash, original }) + "\n";
  try { await writeFile(backup, content, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
  if (await readFile(backup, "utf8") !== content) throw new Error("The saved-permission original archive failed verification.");
  const workspaces = await Promise.all(config.workspaces.map(async workspace => ({ id: workspace.id, directory: await canonicalFilePath(workspace.directory?.trim() || workspace.path) })));
  const result: SavedNativeApprovalMigration = { version: 1, source, sourceHash, backup, sourceRows: original.rows.length, imports: [], unresolved: [] };
  for (const [sourceRow, row] of original.rows.entries()) {
    const project = original.projects.find(project => project.id === row.project_id);
    if (row.project_id === "global" || project?.worktree === "/") { result.unresolved.push({ sourceRow, reason: "global_project" }); continue; }
    if (!project || typeof project.worktree !== "string") { result.unresolved.push({ sourceRow, reason: "unknown_project" }); continue; }
    const roots = [...new Set(await Promise.all([project.worktree, ...original.directories.filter(item => item.project_id === row.project_id).map(item => item.directory)]
      .filter((directory): directory is string => typeof directory === "string").map(canonicalFilePath)))];
    const candidates = workspaces.filter(workspace => roots.some(root => within(root, workspace.directory)));
    // A native Git project may contain more than one LegalWork project. Its old
    // grant contains no originating chat ID, so never guess a narrower owner.
    if (candidates.length !== 1 || !roots.every(root => root === candidates[0]?.directory)) {
      result.unresolved.push({ sourceRow, reason: candidates.length ? "shared_project" : "unknown_project" }); continue;
    }
    let records: Array<z.infer<typeof saved>>;
    try {
      if (original.columns.includes("data")) {
        const rules = importLegacySessionPermissionRules(JSON.parse(String(row.data)));
        if (rules.some(rule => rule.effect !== "allow")) { result.unresolved.push({ sourceRow, reason: "non_allow_saved_policy" }); continue; }
        records = rules.map(rule => saved.parse({ action: rule.action, resource: rule.resource, createdAt: row.time_created, updatedAt: row.time_updated }));
      } else records = [saved.parse({ action: row.action, resource: row.resource, createdAt: row.time_created, updatedAt: row.time_updated })];
    } catch { result.unresolved.push({ sourceRow, reason: "invalid_saved_policy" }); continue; }
    for (const record of records) result.imports.push({ ...record, workspaceID: candidates[0].id, id: `psv_${hash([source, row.project_id, row.id ?? row.data, record.action, record.resource])}` });
  }
  return result;
}

/** The engine must be stopped. Explicit reconfirmation is required for old
 * grants whose LegalWork owner cannot be proved; originals remain private. */
export async function activateNativeSavedApprovalMigration(config: ServerConfig, prepared: SavedNativeApprovalMigration,
  choice: { ambiguous: "hold" | "reconfirm" }): Promise<{ imported: number; reconfirm: number }> {
  return withFileWriteLock(`${prepared.source}.legalwork-saved-permissions.lock`, async () => {
    const original = await snapshot(prepared.source);
    if (hash(original) !== prepared.sourceHash) throw new Error("Saved permissions changed since review; prepare their migration again.");
    const archived: unknown = JSON.parse(await readFile(prepared.backup, "utf8"));
    if (!archived || typeof archived !== "object" || !("original" in archived) || hash(archived.original) !== prepared.sourceHash) throw new Error("The exact original saved permissions are not safely archived.");
    if (prepared.unresolved.some(item => item.reason === "invalid_saved_policy" || item.reason === "non_allow_saved_policy")) throw new Error("An existing saved policy needs explicit resolution before the engine can start; its original is preserved.");
    if (prepared.unresolved.length && choice.ambiguous !== "reconfirm") throw new Error("Some older saved approvals have no unique LegalWork project; choose reconfirmation before starting the engine.");
    const imported = await prepareNativeSavedApprovalMigration(config, prepared.source);
    if (JSON.stringify(imported) !== JSON.stringify(prepared)) throw new Error("The reviewed project ownership changed; prepare saved permissions again.");
    for (const workspaceID of new Set(prepared.imports.map(item => item.workspaceID))) {
      await writeRuntimeOpencodeConfig(config, workspaceID, current => ({ ...current, projectPermissionApprovals: [
        ...current.projectPermissionApprovals ?? [],
        ...prepared.imports.filter(item => item.workspaceID === workspaceID && !(current.projectPermissionApprovals ?? []).some(record => record.id === item.id || record.action === item.action && record.resources.includes(item.resource)))
          .map(item => ({ id: item.id, action: item.action, resources: [item.resource], createdAt: item.createdAt, updatedAt: item.updatedAt })),
      ] }));
    }
    if (original.rows.length) {
      if (typeof process.versions.bun === "string") {
        const { Database } = await import("bun:sqlite"); const db = new Database(prepared.source);
        try { db.transaction(() => { if (hash(db.query("SELECT * FROM permission ORDER BY project_id").all()) !== hash(original.rows)) throw new Error("Saved permissions changed during migration."); db.exec("DELETE FROM permission"); })(); }
        finally { db.close(); }
      } else {
        const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(prepared.source);
        try { db.exec("BEGIN IMMEDIATE"); if (hash(db.prepare("SELECT * FROM permission ORDER BY project_id").all()) !== hash(original.rows)) throw new Error("Saved permissions changed during migration."); db.exec("DELETE FROM permission; COMMIT"); }
        catch (error) { db.exec("ROLLBACK"); throw error; }
        finally { db.close(); }
      }
    }
    // This receipt is private and deliberately contains no paths or resources
    // in its user-facing count. A future grant asks normally in its project.
    await writeFile(`${prepared.backup}.activated.json`, JSON.stringify({ version: 1, sourceHash: prepared.sourceHash, backup: prepared.backup, imported: prepared.imports.length, reconfirm: prepared.unresolved.length, activatedAt: Date.now() }) + "\n", { mode: 0o600 });
    return { imported: prepared.imports.length, reconfirm: prepared.unresolved.length };
  });
}
