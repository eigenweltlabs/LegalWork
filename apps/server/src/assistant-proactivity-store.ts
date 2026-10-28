import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { openSqlite, runtimeDbPath, type SqliteHandle } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";
import { ProactiveEventSchema, ScratchpadWriteSchema, type ProactiveEvent } from "./assistant-proactivity-schema.js";

const ScratchpadSchema = z.object({ text: z.string(), revision: z.number(), updatedAt: z.number() });
const OfferSchema = z.object({ state: z.enum(["unoffered", "offered", "declined"]), at: z.number() });

/** Application-owned checkpoints; only an Assistant tool can write the scratchpad. */
export class AssistantProactivityStore {
  private constructor(private db: SqliteHandle) {}
  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true });
    const db = await openSqlite(path);
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_proactivity_state (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_proactivity_events (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', revision INTEGER, delivery_id TEXT, session_id TEXT, decided_at INTEGER);`);
    return new AssistantProactivityStore(db);
  }
  private read(key: string): unknown {
    const row = this.db.get("SELECT data FROM assistant_proactivity_state WHERE key = ?", [key]);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  private write(key: string, value: unknown) {
    this.db.run("INSERT INTO assistant_proactivity_state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data", [key, JSON.stringify(value)]);
  }
  scratchpad() { return ScratchpadSchema.parse(this.read("scratchpad") ?? { text: "", revision: 0, updatedAt: 0 }); }
  updateScratchpad(raw: unknown, now = Date.now()) {
    const input = ScratchpadWriteSchema.parse(raw);
    return this.transaction(() => {
      const current = this.scratchpad();
      if (current.revision !== input.revision) throw new ApiError(409, "scratchpad_changed", "Read the current scratchpad before editing it again.");
      const saved = { text: input.text, revision: current.revision + 1, updatedAt: now };
      this.write("scratchpad", saved);
      return saved;
    });
  }
  briefingOffer() { return OfferSchema.parse(this.read("briefing-offer") ?? { state: "unoffered", at: 0 }); }
  markBriefingOffer(state: "offered" | "declined", now = Date.now()) {
    return this.transaction(() => {
      const previous = this.briefingOffer();
      if (state === "offered" && previous.state !== "unoffered") return false;
      this.write("briefing-offer", { state, at: now });
      return true;
    });
  }
  cursor(source: string) { return z.string().optional().parse(this.read(`cursor:${source}`)); }
  ingest(source: string, cursor: string, events: ProactiveEvent[]) {
    this.transaction(() => {
      for (const event of events) this.db.run("INSERT OR IGNORE INTO assistant_proactivity_events(id, data) VALUES (?, ?)", [event.id, JSON.stringify(ProactiveEventSchema.parse(event))]);
      this.write(`cursor:${source}`, cursor);
    });
  }
  pending(limit = 20) {
    return this.db.all("SELECT data FROM assistant_proactivity_events WHERE status = 'pending' ORDER BY rowid LIMIT ?", [limit])
      .map(row => ProactiveEventSchema.parse(JSON.parse(String(row.data))));
  }
  settle(id: string, status: "ignored" | "sent" | "failed", revision: number, now = Date.now()) {
    this.db.run("UPDATE assistant_proactivity_events SET status = ?, revision = ?, decided_at = ? WHERE id = ?", [status, revision, now, id]);
  }
  delivery(id: string) {
    const row = this.db.get("SELECT delivery_id, session_id FROM assistant_proactivity_events WHERE id = ?", [id]);
    return row?.delivery_id && row.session_id ? { id: String(row.delivery_id), sessionId: String(row.session_id) } : null;
  }
  prepareDelivery(id: string, deliveryId: string, sessionId: string) {
    this.db.run("UPDATE assistant_proactivity_events SET delivery_id = ?, session_id = ? WHERE id = ? AND delivery_id IS NULL", [deliveryId, sessionId, id]);
    return this.delivery(id);
  }
  recent() {
    return this.db.all("SELECT data FROM assistant_proactivity_events WHERE status = 'sent' ORDER BY decided_at DESC LIMIT 10")
      .map(row => ProactiveEventSchema.parse(JSON.parse(String(row.data))));
  }
  prune(now = Date.now()) { this.db.run("DELETE FROM assistant_proactivity_events WHERE decided_at < ?", [now - 30 * 86400_000]); }
  lease(owner: string, now = Date.now()) {
    return this.transaction(() => {
      const lease = z.object({ owner: z.string(), until: z.number() }).optional().parse(this.read("runtime-lease"));
      if (lease && lease.owner !== owner && lease.until > now) return false;
      this.write("runtime-lease", { owner, until: now + 10 * 60_000 });
      return true;
    });
  }
  release(owner: string) {
    this.transaction(() => {
      const lease = z.object({ owner: z.string(), until: z.number() }).optional().parse(this.read("runtime-lease"));
      if (lease?.owner === owner) this.write("runtime-lease", { owner, until: 0 });
    });
  }
  context() {
    const failures = Number(this.db.get("SELECT count(*) AS count FROM assistant_proactivity_events WHERE status = 'failed'")?.count ?? 0);
    return `Assistant-managed scratchpad (revision ${this.scratchpad().revision}; empty means no event alerts):\n${JSON.stringify(this.scratchpad().text)}\nMorning briefing suggestion state: ${this.briefingOffer().state}.${failures ? ` ${failures} proactive update deliveries were rejected by the engine. Do not claim those updates were delivered.` : ""}`;
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}

const stores = new WeakMap<ServerConfig, Promise<AssistantProactivityStore>>();
export function assistantProactivityStore(config: ServerConfig) {
  let store = stores.get(config);
  if (!store) { store = AssistantProactivityStore.open(runtimeDbPath(config)); stores.set(config, store); }
  return store;
}
