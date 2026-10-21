import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantConversations } from "./assistant-conversations.js";

const workspace = { id: "assistant", path: "/projects/Assistant" };
test("conversations are explicit, independent of the day, and keep daily history readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "assistant-conversations-"));
  let created = 0;
  const engine = { create: async (title: string) => ({ id: `ses_${++created}`, title, directory: workspace.path, time: {} }) };
  try {
    const store = await AssistantConversations.open(join(root, "runtime.sqlite"), () => [{ date: "2026-10-20", sessionId: "day-20" }, { date: "2026-10-21", sessionId: "day-21" }]);
    expect(store.current(workspace.id)).toBeNull();
    expect(store.list(workspace.id).items.map(item => item.id)).toEqual(["day:2026-10-21", "day:2026-10-20"]);
    const first = await store.create(workspace, engine, { title: "Müller lease", origin: "panel" }, Date.parse("2026-10-21T23:59:00"));
    const second = await store.create(workspace, engine, {}, Date.parse("2026-10-22T00:01:00"));
    expect(second.title).toBe("2026-10-22 00:01");
    expect(store.current(workspace.id)?.id).toBe(second.id);
    // Midnight passes without changing identity: a reply at 00:01 still belongs to the first conversation.
    store.touch(workspace.id, first.sessionId, Date.parse("2026-10-22T00:02:00"));
    expect(store.current(workspace.id)?.id).toBe(first.id);
    expect(store.bySession(workspace.id, "day-20")?.kind).toBe("day");
    expect(store.find(workspace.id, "day:2026-10-21")?.sessionId).toBe("day-21");
    expect(store.list(workspace.id, { query: "müller" }).items.map(item => item.id)).toEqual([first.id]);
    store.update(workspace.id, second.id, { pinned: true });
    expect(store.list(workspace.id).items.map(item => item.id)).toEqual([second.id, first.id, "day:2026-10-21", "day:2026-10-20"]);
    const archived = store.update(workspace.id, first.id, { archived: true, title: "Lease (done)" });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.title).toBe("Lease (done)");
    expect(store.list(workspace.id).items.map(item => item.id)).toEqual([second.id, "day:2026-10-21", "day:2026-10-20"]);
    expect(store.list(workspace.id, { includeArchived: true, limit: 2 })).toMatchObject({ nextCursor: "2" });
    // Delivering into an archived conversation never unarchives it.
    store.touch(workspace.id, first.sessionId);
    expect(store.find(workspace.id, first.id)?.archivedAt).not.toBeNull();
    expect(() => store.update(workspace.id, "day:2026-10-20", { archived: true })).toThrow("Daily history");
    expect(() => store.list(workspace.id, { cursor: "x" })).toThrow("Refresh");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a conversation created outside the Assistant project is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "assistant-conversations-scope-"));
  try {
    const store = await AssistantConversations.open(join(root, "runtime.sqlite"), () => []);
    await expect(store.create(workspace, { create: async title => ({ id: "x", title, directory: "/elsewhere", time: {} }) })).rejects.toThrow("outside the Assistant project");
    expect(store.list(workspace.id).items).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
