import { expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AssistantSubmission } from "@legalwork/types/launcher";
import { enqueueAssistantSubmission, sendAssistantSubmission } from "./assistant-submission-send.js";
import { SessionMessageQueue } from "./session-message-queue.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("commands use the engine command endpoint with arguments, preferences and stable message identity", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const engine = Bun.serve({ port: 0, async fetch(request) { calls.push({ path: new URL(request.url).pathname, body: await request.json() }); return Response.json({}); } });
  const entry: AssistantSubmission = { requestId: "request", messageId: "msg_1234567890abc", workspaceId: "matter", conversationId: "origin", sessionId: "project-chat", target: { kind: "project", workspaceId: "matter" }, state: "sending", preview: "/compare a b", createdAt: 1, updatedAt: 1, error: null };
  try {
    await sendAssistantSubmission(createOpencodeClient({ baseUrl: engine.url.origin }), entry, { parts: [{ type: "text", text: "/compare a b" }], command: { name: "compare", arguments: "a b" }, model: { providerID: "provider", modelID: "model" }, agent: "reviewer", variant: "deep" });
    expect(calls).toEqual([{ path: "/session/project-chat/command", body: { messageID: entry.messageId, command: "compare", arguments: "a b", agent: "reviewer", model: "provider/model", variant: "deep", parts: [] } }]);
  } finally { engine.stop(true); }
});

test("Home's durable queue retains the shared message identity, context and edits across restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "assistant-queue-"));
  const transport = { idle: async () => false, send: async () => {} };
  let queue = new SessionMessageQueue(root, transport);
  const entry: AssistantSubmission = { requestId: "request", messageId: "msg_1234567890abc", workspaceId: "assistant", conversationId: "origin", sessionId: "chat", target: { kind: "project", workspaceId: "matter" }, state: "sending", preview: "Review", createdAt: 1, updatedAt: 1, error: null };
  const queued = { id: crypto.randomUUID(), draft: { mode: "prompt", text: "Review", parts: [{ type: "text", text: "Review" }], attachments: [], editor: { mentions: {}, pasteParts: [] } } } satisfies NonNullable<Parameters<typeof enqueueAssistantSubmission>[2]["queue"]>;
  const payload = { queue: queued, model: { providerID: "test", modelID: "model" }, parts: [{ type: "text", text: "Bound to matter", synthetic: true }], command: { name: "review", arguments: "contract" } } satisfies Parameters<typeof enqueueAssistantSubmission>[2];
  try {
    await enqueueAssistantSubmission(queue, entry, payload);
    await enqueueAssistantSubmission(queue, entry, payload);
    queue.stop(); queue = new SessionMessageQueue(root, transport);
    const restored = await queue.read("assistant", "chat");
    expect(restored.entries).toHaveLength(1);
    expect(restored.entries[0]).toMatchObject({ id: queued.id, messageId: entry.messageId, execution: { kind: "command", command: "review", arguments: "contract\n\nBound to matter", model: "test/model" } });
    const token = crypto.randomUUID();
    await queue.act("assistant", "chat", { type: "edit", id: queued.id, token, revision: restored.revision });
    await enqueueAssistantSubmission(queue, { ...entry, messageId: "msg_edited123456789" }, { ...payload, queue: { ...queued, editToken: token }, command: { name: "review", arguments: "edited" } });
    expect((await queue.read("assistant", "chat")).entries[0]).toMatchObject({ messageId: "msg_edited123456789", execution: { arguments: "edited\n\nBound to matter" } });
  } finally { queue.stop(); await rm(root, { recursive: true, force: true }); }
});
