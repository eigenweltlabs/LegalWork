import { expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AssistantSubmission } from "@legalwork/types/launcher";
import { readAssistantOutput } from "./assistant-output.js";

const submission: AssistantSubmission = { requestId: "request", messageId: "msg_original", conversationId: "conversation", workspaceId: "assistant", sessionId: "session", state: "accepted", target: { kind: "assistant" }, createdAt: 1, updatedAt: 1, error: null, preview: "Question" };
const answer = (parentID: string, finish = "stop") => ({ info: { id: "msg_answer", role: "assistant", parentID, sessionID: "session", time: { created: 2, completed: 3 }, finish }, parts: [{ type: "text", text: "Answer" }, { type: "text", synthetic: true, text: "hidden" }] });

test("automatic output pages past newer conversations and reads only the exact finished answer", async () => {
  const cursors: (string | null)[] = [];
  const server = Bun.serve({ port: 0, fetch(request) {
    const before = new URL(request.url).searchParams.get("before"); cursors.push(before);
    return before ? Response.json([answer("msg_original")]) : Response.json([answer("different-request")], { headers: { "x-next-cursor": "opaque-cursor" } });
  } });
  try {
    const output = await readAssistantOutput(createOpencodeClient({ baseUrl: server.url.href }), submission);
    expect(output).toEqual({ state: "ready", requestId: "request", messageId: "msg_original", conversationId: "conversation", text: "Answer" });
    expect(cursors).toEqual([null, "opaque-cursor"]);
  } finally { server.stop(true); }
});
test("partial replies and unrelated replies are never automatically output", async () => {
  let finish = "tool-calls", parent = "msg_original";
  const server = Bun.serve({ port: 0, fetch: () => Response.json([answer(parent, finish)]) });
  try {
    const client = createOpencodeClient({ baseUrl: server.url.href });
    expect((await readAssistantOutput(client, submission)).state).toBe("pending");
    finish = "length"; expect((await readAssistantOutput(client, submission)).state).toBe("failed");
    parent = "another"; finish = "stop"; expect((await readAssistantOutput(client, submission)).state).toBe("pending");
  } finally { server.stop(true); }
});
