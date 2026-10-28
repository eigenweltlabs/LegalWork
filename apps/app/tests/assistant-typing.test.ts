import { expect, test } from "bun:test";
import type { Part } from "@/app/lib/opencode-view";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { assistantBubbleMessages } from "../src/react-app/domains/session/surface/assistant-bubbles";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";

test("native text events preserve complete-bubble delivery through reasoning and tool work", async () => {
  const input = { workspaceId: "typing-project", baseUrl: "http://127.0.0.1:1", legalworkToken: "test" };
  const sessionId = "typing-session";
  const dispose = __createWorkspaceSessionSyncForTest(input);
  const release = trackWorkspaceSessionSync(input, sessionId);
  const query = getReactQueryClient();
  const messageId = "reply";
  const transcript = () => query.getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, sessionId)) ?? [];
  const event = (type: string, data: object) => __applySessionSyncEventForTest(input, { id: "event", created: 1, type, durable: { aggregateID: sessionId, seq: "1", version: 1 }, data: { sessionID: sessionId, assistantMessageID: messageId, ...data } });
  try {
    event("session.step.started", {});
    event("session.reasoning.started", { ordinal: 0 });
    event("session.reasoning.ended", { ordinal: 0, text: "Find the correct project" });
    event("session.text.started", { ordinal: 1 });
    event("session.text.delta", { ordinal: 1, delta: "I will check and follow up." });
    await Bun.sleep(0);
    expect(assistantBubbleMessages(transcript(), null, true)).toEqual([]);
    event("session.text.ended", { ordinal: 1, text: "I will check and follow up." });
    expect(assistantBubbleMessages(transcript(), null, true)[0].parts).toHaveLength(1);
    event("session.tool.input.started", { id: "delegate", name: "legalwork_assistant_delegate" });
    event("session.tool.called", { id: "delegate", input: { task: "Check replies" } });
    event("session.text.started", { ordinal: 3 });
    event("session.text.delta", { ordinal: 3, delta: "The results are ready." });
    await Bun.sleep(0);
    expect(assistantBubbleMessages(transcript(), null, true)[0].parts).toHaveLength(2);
    event("session.text.ended", { ordinal: 3, text: "The results are ready." });
    expect(assistantBubbleMessages(transcript(), null, true)[0].parts).toHaveLength(3);
  } finally { release(); dispose(); query.clear(); }
});

test("snapshots preserve buffering until text or its message completes", () => {
  const info = { id: "reply", sessionID: "chat", role: "assistant", parentID: "user", modelID: "model", providerID: "provider", mode: "legalwork", agent: "legalwork", path: { cwd: "/matter", root: "/matter" }, time: { created: 1 }, cost: 0, tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } satisfies LegalworkSessionSnapshot["messages"][number]["info"];
  const part: Part = { id: "text", sessionID: "chat", messageID: "reply", type: "text", text: "The result", time: { start: 2 } };
  const snapshot: LegalworkSessionSnapshot = { session: { id: "chat", title: "Replies", version: "1", time: { created: 1, updated: 2 } }, status: { type: "busy" }, todos: [], messages: [{ info, parts: [part] }] };
  const messages = snapshotToUIMessages(snapshot);
  expect(assistantBubbleMessages(messages, snapshot, true)).toEqual([]);
  expect(assistantBubbleMessages(messages, { messages: [{ info, parts: [{ ...part, time: { start: 2, end: 3 } }] }] }, true)).toEqual(messages);
  expect(assistantBubbleMessages(messages, { messages: [{ info: { ...info, time: { created: 1, completed: 3 } }, parts: [part] }] }, true)).toEqual(messages);
  for (const hidden of [{ synthetic: true }, { ignored: true }]) {
    expect(assistantBubbleMessages(snapshotToUIMessages({ ...snapshot, messages: [{ info, parts: [{ ...part, ...hidden }] }] }), snapshot, true)).toEqual([]);
  }
});
