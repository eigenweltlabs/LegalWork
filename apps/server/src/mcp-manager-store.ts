import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { OAuthClientInformationSchema, OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ApiError } from "./errors.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import { openSqlite, type SqliteHandle } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";

export const remoteMcpSchema = z.object({
  type: z.literal("remote"), url: z.string().url(), enabled: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(), timeout: z.number().positive().optional(),
  oauth: z.union([z.literal(false), z.object({
    clientId: z.string().optional(), clientSecret: z.string().optional(), scope: z.string().optional(),
    callbackPort: z.number().int().min(1).max(65535).optional(), redirectUri: z.string().url().optional(),
  })]).optional(),
});
export type RemoteMcp = z.infer<typeof remoteMcpSchema>;
export const FIRM_MCP_SCOPE = "__firm_mcp__:";
const recordSchema = z.object({
  id: z.uuid(), key: z.string(), revision: z.uuid(), config: remoteMcpSchema,
  client: OAuthClientInformationSchema.optional(), tokens: OAuthTokensSchema.optional(),
  expiresAt: z.number().finite().optional(), reconnectRequired: z.boolean().optional(),
  issuer: z.string().url().optional(),
  configurationHash: z.string().optional(),
});
export type ManagedMcpRecord = z.infer<typeof recordSchema>;
const recordsSchema = z.record(z.string(), recordSchema);
const envelopeSchema = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
const aad = Buffer.from("legalwork-managed-mcp-v1");
export function isMcpSecureStorageError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code.startsWith("mcp_secure_storage_");
}

/** A dedicated SQLite write transaction is an OS-released, crash-safe owner lock.
 * It never locks the application's runtime database or a network request's transaction. */
export class McpManagerStore {
  readonly path: string;
  private owner?: SqliteHandle;
  private key?: Buffer;
  private records: Record<string, ManagedMcpRecord> = {};
  private sourceConfigurations = new Map<string, RemoteMcp>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private config: ServerConfig) {
    this.path = join(runtimeStorageDir(config), "managed-mcp.vault");
  }

  async open() {
    await mkdir(runtimeStorageDir(this.config), { recursive: true });
    const owner = await openSqlite(`${this.path}.owner.sqlite`);
    try { owner.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE"); }
    catch { owner.close(); throw new ApiError(409, "mcp_manager_in_use", "Another LegalWork server owns this connector store."); }
    this.owner = owner;
    try {
      const key = this.config.mcpVaultKey ? Buffer.from(await this.config.mcpVaultKey())
        : process.env.LEGALWORK_ENCRYPTION_KEY ? createHash("sha256").update(process.env.LEGALWORK_ENCRYPTION_KEY).digest() : undefined;
      if (!key || key.length !== 32) throw new ApiError(503, "mcp_secure_storage_unavailable", "Unlock desktop secure storage or set LEGALWORK_ENCRYPTION_KEY to use managed MCP connections.");
      this.key = key;
      let content: string;
      try { content = await readFile(this.path, "utf8"); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
      const envelope = envelopeSchema.parse(JSON.parse(content));
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(aad);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      this.records = recordsSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString()));
    } catch (error) {
      this.close();
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "mcp_secure_storage_unreadable", "Saved connector credentials could not be unlocked. Restore access to secure storage before reconnecting.");
    }
  }

  get(key: string) {
    const record = this.records[key];
    return record ? structuredClone({ ...record, config: this.sourceConfigurations.get(key) ?? record.config }) : undefined;
  }
  all() { return Object.keys(this.records).flatMap(key => { const record = this.get(key); return record ? [record] : []; }); }
  hydrate(key: string, config: RemoteMcp) { this.sourceConfigurations.set(key, structuredClone(config)); }

  async put(record: ManagedMcpRecord) {
    // Firm-managed secrets remain source-owned and memory-only. Persist the
    // member's OAuth grant, not the firm's API key or configured client secret.
    const sourceOwned = record.key.startsWith(`["${FIRM_MCP_SCOPE}`);
    const stored = sourceOwned ? { ...record, config: { ...record.config, headers: undefined,
      oauth: record.config.oauth ? { ...record.config.oauth, clientSecret: undefined } : record.config.oauth } } : record;
    await this.mutate(records => { records[record.key] = recordSchema.parse(stored); });
    if (sourceOwned) this.hydrate(record.key, record.config);
  }
  async remove(key: string) { await this.mutate(records => { delete records[key]; }); this.sourceConfigurations.delete(key); }

  private async mutate(update: (records: Record<string, ManagedMcpRecord>) => void) {
    const job = this.queue.then(async () => {
      if (!this.owner || !this.key) throw new Error("MCP credential store is closed.");
      const next = structuredClone(this.records);
      update(next);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(aad);
      const data = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
      await rename(tmp, this.path);
      this.records = next;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  async drain() { await this.queue; }
  close() { this.owner?.close(); this.owner = undefined; this.key?.fill(0); this.key = undefined; this.sourceConfigurations.clear(); }
}
