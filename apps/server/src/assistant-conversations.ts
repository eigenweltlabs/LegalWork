import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { ApiError } from "./errors.js";
import { openSqlite, type Row, type SqliteHandle } from "./runtime-db.js";
import { matchesSearch } from "./search-schema.js";
import type { AssistantConversation } from "@legalwork/types/launcher";

type Session = { id: string; title: string; directory: string; time: { archived?: number } };
export type ConversationEngine = { create: (title: string) => Promise<Session> };
export type AssistantDay = { date: string; sessionId: string };
const DAY_PREFIX = "day:";
export const conversationIdForDay = (date: string) => `${DAY_PREFIX}${date}`;
const dayTime = (date: string) => new Date(`${date}T12:00:00`).getTime();

/**
 * Independent Assistant conversations in the server-owned Assistant workspace.
 * Identity is the conversation, never "today": expanding a window or waiting
 * past midnight keeps the same engine session. Daily sessions remain readable.
 */
export class AssistantConversations {
  private constructor(private db: SqliteHandle, private days: (workspaceId: string) => AssistantDay[]) {}
  static async open(path: string, days: (workspaceId: string) => AssistantDay[]) {
    const db = await openSqlite(path);
    db.exec("CREATE TABLE IF NOT EXISTS assistant_conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, origin TEXT)");
    db.exec("CREATE INDEX IF NOT EXISTS assistant_conversations_workspace ON assistant_conversations (workspace_id, updated_at)");
    return new AssistantConversations(db, days);
  }
  private item(row: Row): AssistantConversation {
    return { id: String(row.id), workspaceId: String(row.workspace_id), sessionId: String(row.session_id), title: String(row.title), kind: "conversation", date: null,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), pinned: Number(row.pinned) === 1, archivedAt: row.archived_at === null || row.archived_at === undefined ? null : Number(row.archived_at), origin: row.origin === null || row.origin === undefined ? null : String(row.origin) };
  }
  private dayItem(workspaceId: string, day: AssistantDay): AssistantConversation {
    const time = dayTime(day.date);
    return { id: conversationIdForDay(day.date), workspaceId, sessionId: day.sessionId, title: day.date, kind: "day", date: day.date, createdAt: time, updatedAt: time, pinned: false, archivedAt: null, origin: "day" };
  }
  private explicit(workspaceId: string) {
    return this.db.all("SELECT * FROM assistant_conversations WHERE workspace_id = ? ORDER BY updated_at DESC", [workspaceId]).map(row => this.item(row));
  }
  /** Explicit conversations first by recency, pinned ahead, then legacy days. Never creates anything. */
  list(workspaceId: string, input: { query?: string; cursor?: string; limit?: number; includeArchived?: boolean } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const sessions = new Set<string>();
    const all = [...this.explicit(workspaceId), ...this.days(workspaceId).map(day => this.dayItem(workspaceId, day))]
      .filter(item => { if (sessions.has(item.sessionId)) return false; sessions.add(item.sessionId); return true; })
      .filter(item => (input.includeArchived || item.archivedAt === null) && (!input.query || matchesSearch(`${item.title} ${item.date ?? ""}`, input.query)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id, "en"));
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, "conversation_cursor", "Refresh the conversation list.");
    const items = all.slice(offset, offset + limit);
    return { items, nextCursor: offset + limit < all.length ? String(offset + limit) : null };
  }
  find(workspaceId: string, id: string): AssistantConversation | null {
    if (id.startsWith(DAY_PREFIX)) {
      const day = this.days(workspaceId).find(day => day.date === id.slice(DAY_PREFIX.length));
      return day ? this.dayItem(workspaceId, day) : null;
    }
    const row = this.db.get("SELECT * FROM assistant_conversations WHERE workspace_id = ? AND id = ?", [workspaceId, id]);
    return row ? this.item(row) : null;
  }
  bySession(workspaceId: string, sessionId: string): AssistantConversation | null {
    const row = this.db.get("SELECT * FROM assistant_conversations WHERE workspace_id = ? AND session_id = ?", [workspaceId, sessionId]);
    if (row) return this.item(row);
    const day = this.days(workspaceId).find(day => day.sessionId === sessionId);
    return day ? this.dayItem(workspaceId, day) : null;
  }
  /** The conversation to resume: the most recent one that is not archived, or null without creating one. */
  current(workspaceId: string): AssistantConversation | null {
    const row = this.db.get("SELECT * FROM assistant_conversations WHERE workspace_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1", [workspaceId]);
    return row ? this.item(row) : null;
  }
  async create(workspace: { id: string; path: string }, engine: ConversationEngine, input: { title?: string; origin?: string } = {}, now = Date.now()) {
    const date = new Date(now);
    const fallback = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const title = input.title?.trim().slice(0, 160) || fallback;
    const session = await engine.create(title);
    if (resolve(session.directory) !== resolve(workspace.path)) throw new ApiError(502, "assistant_session_scope", "The engine created the conversation outside the Assistant project.");
    const id = `conv_${randomBytes(8).toString("hex")}`;
    this.db.run("INSERT INTO assistant_conversations (id, workspace_id, session_id, title, created_at, updated_at, pinned, archived_at, origin) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)", [id, workspace.id, session.id, title, now, now, input.origin ?? null]);
    return this.find(workspace.id, id) as AssistantConversation;
  }
  update(workspaceId: string, id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }, now = Date.now()) {
    const current = this.find(workspaceId, id);
    if (!current) throw new ApiError(404, "conversation_not_found", "This conversation is no longer available.");
    if (current.kind === "day") throw new ApiError(409, "conversation_legacy", "Daily history cannot be renamed or archived. Start a new conversation instead.");
    this.db.run("UPDATE assistant_conversations SET title = ?, pinned = ?, archived_at = ? WHERE workspace_id = ? AND id = ?", [
      patch.title?.trim().slice(0, 160) || current.title, patch.pinned ?? current.pinned ? 1 : 0,
      patch.archived === undefined ? current.archivedAt : patch.archived ? current.archivedAt ?? now : null, workspaceId, id,
    ]);
    return this.find(workspaceId, id) as AssistantConversation;
  }
  /** A submission keeps the conversation current without unarchiving it. */
  touch(workspaceId: string, sessionId: string, now = Date.now()) {
    this.db.run("UPDATE assistant_conversations SET updated_at = ? WHERE workspace_id = ? AND session_id = ? AND archived_at IS NULL", [now, workspaceId, sessionId]);
  }
}
