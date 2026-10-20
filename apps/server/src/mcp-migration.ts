import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { OAuthVault, oauthVaultPath } from "./file-storage/oauth/vault.js";
import { mcpManager } from "./mcp-manager.js";
import { isMcpSecureStorageError, type ManagedMcpRecord } from "./mcp-manager-store.js";
import { runtimeMcpMapForWorkspace } from "./mcp.js";
import { firmHubConnectorBlocks } from "./firm-hub.js";
import type { ServerConfig } from "./types.js";

const run = promisify(execFile);
const object = z.record(z.string(), z.unknown());
const legacyEntry = z.object({
  serverUrl: z.string().url(),
  tokens: z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1).optional(),
    expiresAt: z.number().finite().nonnegative().optional(), scope: z.string().optional() }),
  clientInfo: z.object({ clientId: z.string().min(1), clientSecret: z.string().optional(),
    clientIdIssuedAt: z.number().finite().optional(), clientSecretExpiresAt: z.number().finite().optional() }).optional(),
});
const transfer = z.object({ name: z.string(), target: z.string(), revision: z.string(), original: z.unknown(),
  entry: legacyEntry, complete: z.boolean() });
const journalSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), transfer) });
const absent = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function legacyMcpAuthPath() {
  const data = process.env.XDG_DATA_HOME?.trim();
  return join(data && isAbsolute(data) ? data : join(homedir(), ".local", "share"), "opencode", "mcp-auth.json");
}

/** Conservative: a separate OpenCode might still hold this global grant in memory.
 * Inspect executable names only, never command-line credentials or environment. */
export function hasOpencodeProcess(output: string, platform = process.platform, ignoredPids: ReadonlySet<number> = new Set()) {
  return output.split(/\r?\n/).some(line => {
    if (platform === "win32") {
      const entry = line.match(/^"(opencode(?:-[^"\r\n]*)?\.exe)","(\d+)"/i);
      return Boolean(entry && !ignoredPids.has(Number(entry[2])));
    }
    const entry = line.trim().match(/^(\d+)\s+(.+)$/);
    return Boolean(entry && !ignoredPids.has(Number(entry[1])) && /(?:^|\/)opencode(?:-[\w.-]+)?$/i.test(entry[2]!));
  });
}
export async function legacyMcpQuiescent(ignoredPids: ReadonlySet<number> = new Set()) {
  try {
    const result = process.platform === "win32"
      ? await run("tasklist", ["/FO", "CSV", "/NH"], { timeout: 2000 })
      : await run("ps", ["-u", String(process.getuid?.()), "-o", "pid=,comm="], { timeout: 2000 });
    const valid = process.platform === "win32" ? /^"[^"]+","\d+",/m.test(result.stdout) : /^\s*\d+\s+\S/m.test(result.stdout);
    return valid && !hasOpencodeProcess(result.stdout, process.platform, ignoredPids);
  } catch { return false; }
}

async function readSource(path: string) {
  try { return object.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { if (absent(error)) return {}; throw new ApiError(503, "mcp_migration_unreadable", "Saved connector sign-ins could not be read. The original file has been preserved."); }
}

/** Called before starting a managed engine. The journal uses the existing vault;
 * no source grant is retired before its encrypted recovery copy is durable. */
async function transferLegacyMcpOAuth(config: ServerConfig, options: {
  authPath?: string;
  quiescent?: () => Promise<boolean>;
} = {}) {
  const manager = mcpManager(config);
  if (!manager || config.readOnly) return { migrated: [], deferred: false };
  const candidates = new Map<string, Map<string, ManagedMcpRecord>>();
  try {
    for (const workspace of config.workspaces.filter(item => item.workspaceType !== "remote")) {
      const firm = z.record(z.string(), object).parse(await firmHubConnectorBlocks(config));
      const entries = { ...await runtimeMcpMapForWorkspace(config, workspace.id), ...firm };
      for (const name of Object.keys(entries)) {
        if (entries[name]?.type !== "remote") continue;
        const found = await manager.find(workspace.id, name);
        if (!found || found.record.config.oauth === false) continue;
        const byId = candidates.get(name) ?? new Map<string, ManagedMcpRecord>();
        byId.set(found.record.id, found.record); candidates.set(name, byId);
      }
    }
  } catch (error) { if (isMcpSecureStorageError(error)) return { migrated: [], deferred: true }; throw error; }
  const eligible = [...candidates.values()].some(records => [...records.values()].some(record => !record.tokens && !record.reconnectRequired && !record.legacyMigration));
  if (!eligible) return { migrated: [], deferred: false };
  const inputPath = resolve(options.authPath ?? legacyMcpAuthPath());
  const path = await realpath(inputPath).catch(error => absent(error) ? inputPath : undefined);
  if (!path) return { migrated: [], deferred: true };
  const vault = new OAuthVault(oauthVaultPath(config));
  const journalKey = `managed-mcp-migration:${digest(path)}`;
  const source = await readSource(path);
  const journal = await vault.getEntry(journalKey, journalSchema) ?? { version: 1, entries: {} };
  const resumable = new Set(Object.keys(journal.entries));
  const claimed = new Set(manager.store.all().flatMap(record => record.tokens?.refresh_token ? [record.tokens.refresh_token] : []));
  for (const [name, records] of candidates) {
    // The old store has one account per name. Never duplicate its rotating grant
    // into independent workspace accounts, or overwrite a new login/logout.
    const parsed = legacyEntry.safeParse(source[name]);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const matching = [...records.values()].filter(record => {
      const oauth = record.config.oauth || {};
      return record.config.url === entry.serverUrl && (!oauth.clientId || !entry.clientInfo || oauth.clientId === entry.clientInfo.clientId);
    });
    if (matching.length !== 1) continue;
    const record = matching[0]!;
    if (record.tokens || record.reconnectRequired || record.legacyMigration) continue;
    const oauth = record.config.oauth || {};
    if (entry.serverUrl !== record.config.url) continue;
    if (oauth.clientId && entry.clientInfo && oauth.clientId !== entry.clientInfo.clientId) continue;
    if (!oauth.clientId && !entry.clientInfo) continue;
    if (entry.clientInfo?.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt <= Date.now() / 1000) continue;
    if (!entry.tokens.refreshToken && entry.tokens.expiresAt !== undefined && entry.tokens.expiresAt <= Date.now() / 1000) continue;
    if (entry.tokens.refreshToken && claimed.has(entry.tokens.refreshToken)) continue;
    if (entry.tokens.refreshToken) claimed.add(entry.tokens.refreshToken);
    const id = digest(JSON.stringify([record.id, source[name]]));
    journal.entries[id] ??= { name, target: record.id, revision: record.revision, original: source[name], entry, complete: false };
  }
  let changed = false;
  for (const item of Object.values(journal.entries)) {
    const record = manager.store.all().find(record => record.id === item.target);
    if (!item.complete && (!record || record.revision !== item.revision || record.tokens || record.reconnectRequired || record.legacyMigration)) {
      item.complete = true; changed = true;
    }
  }
  const pending = Object.entries(journal.entries).filter(([, entry]) => !entry.complete);
  if (changed) await vault.setEntry(journalKey, journalSchema, journal);
  if (!pending.length) { manager.clearLegacyMigrationPending(); return { migrated: [], deferred: false }; }
  for (const [, item] of pending) manager.legacyMigrationPending(item.target, item.revision,
    "Your saved connector sign-in is waiting to be transferred. Close other OpenCode applications; LegalWork will retry automatically without a new sign-in.");
  const quiescent = options.quiescent ?? legacyMcpQuiescent;
  if (!await quiescent()) return { migrated: [], deferred: true };

  // Different LegalWork profiles may read the same legacy global file. Serialize
  // handovers across profiles as well as the manager's ordinary vault ownership.
  const { openSqlite } = await import("./runtime-db.js");
  const lock = await openSqlite(`${path}.legalwork-handoff.sqlite`);
  try {
    try { lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE"); }
    catch { return { migrated: [], deferred: true }; }
    if (!await quiescent()) return { migrated: [], deferred: true };
    lock.exec("CREATE TABLE IF NOT EXISTS handoffs (grant_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, connection_id TEXT NOT NULL)");
    const owner = await realpath(vault.path).catch(error => { if (absent(error)) return resolve(vault.path); throw error; });
    const grantId = (item: z.infer<typeof transfer>) => digest(JSON.stringify([item.entry.serverUrl,
      item.entry.tokens.refreshToken ?? item.entry.tokens.accessToken]));
    const current = await readSource(path);
    let retryChangedSource = false;
    const retiring = pending.filter(([id, item]) => {
      const record = manager.store.all().find(record => record.id === item.target);
      const claim = lock.get("SELECT owner, connection_id FROM handoffs WHERE grant_hash = ?", [grantId(item)]);
      if (claim && (claim.owner !== owner || claim.connection_id !== item.target)) { manager.clearLegacyMigrationPending(item.target); return false; }
      if (record && record.revision === item.revision && !record.tokens && !record.reconnectRequired && JSON.stringify(current[item.name]) !== JSON.stringify(item.original)) retryChangedSource = true;
      return record && record.revision === item.revision && !record.tokens && !record.reconnectRequired && !record.legacyMigration &&
        ((current[item.name] === undefined && resumable.has(id) && claim?.owner === owner) || JSON.stringify(current[item.name]) === JSON.stringify(item.original));
    });
    if (!retiring.length) return { migrated: [], deferred: retryChangedSource };
    await vault.setEntry(journalKey, journalSchema, journal);
    for (const [, item] of retiring) lock.run("INSERT OR IGNORE INTO handoffs (grant_hash, owner, connection_id) VALUES (?, ?, ?)", [grantId(item), owner, item.target]);
    // A durable, secret-free claim prevents a second profile from adopting a
    // grant if we crash after preparing the backup or retiring the source.
    lock.exec("COMMIT; BEGIN EXCLUSIVE");
    for (const [, item] of retiring) delete current[item.name];
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(current, null, 2), { mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    const migrated: string[] = [];
    for (const [id, item] of retiring) {
      const { tokens, clientInfo } = item.entry;
      const adopted = await manager.adoptLegacyGrant(item.target, item.revision, { legacyMigration: id,
        tokens: { access_token: tokens.accessToken, token_type: "Bearer", refresh_token: tokens.refreshToken, scope: tokens.scope,
          expires_in: tokens.expiresAt === undefined ? undefined : Math.max(0, tokens.expiresAt - Date.now() / 1000) },
        expiresAt: tokens.expiresAt === undefined ? undefined : tokens.expiresAt * 1000,
        client: clientInfo ? { client_id: clientInfo.clientId, client_secret: clientInfo.clientSecret,
          client_id_issued_at: clientInfo.clientIdIssuedAt, client_secret_expires_at: clientInfo.clientSecretExpiresAt } : undefined,
      });
      journal.entries[id]!.complete = true;
      if (adopted) migrated.push(item.name);
    }
    await vault.setEntry(journalKey, journalSchema, journal);
    return { migrated, deferred: false };
  } finally { lock.close(); }
}

type MigrationOptions = { authPath?: string; quiescent?: () => Promise<boolean> };

/** Recoverable IO failures must preserve the grant and keep the app usable. */
export async function migrateLegacyMcpOAuth(config: ServerConfig, options: MigrationOptions = {}) {
  try { return await transferLegacyMcpOAuth(config, options); }
  catch {
    const manager = mcpManager(config);
    for (const record of manager?.store.all() ?? []) manager?.legacyMigrationPending(record.id, record.revision,
      "Your saved connector sign-in could not be transferred yet. LegalWork has preserved it and will retry automatically. Check access to the saved sign-ins and credential vault.");
    return { migrated: [], deferred: true };
  }
}

/** Owned engines already use oauth:false gateway entries, so only those exact
 * PIDs may be excluded from the legacy ownership check. Every other engine
 * continues to block the handover. Stop waits for any transfer already running. */
export function startLegacyMcpMigrationRetry(config: ServerConfig, ownedPids: () => ReadonlySet<number>, options: MigrationOptions & { intervalMs?: number } = {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = Promise.resolve();
  const retry = () => {
    active = (async () => {
      const result = await migrateLegacyMcpOAuth(config, { ...options, quiescent: options.quiescent ?? (() => legacyMcpQuiescent(ownedPids())) });
      if (!stopped && result.deferred) schedule();
    })();
  };
  const schedule = () => { timer = setTimeout(retry, options.intervalMs ?? 10_000); timer.unref?.(); };
  schedule();
  return async () => { stopped = true; clearTimeout(timer); await active; };
}
