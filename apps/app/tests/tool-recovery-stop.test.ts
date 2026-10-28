import { expect, spyOn, test } from "bun:test";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { t } from "../src/i18n";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import {
  __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest,
  seedSessionState, snapshotKey, trackWorkspaceSessionSync, transcriptKey,
} from "../src/react-app/domains/session/sync/session-sync";
import type { UIMessage } from "ai";

type Message = LegalworkSessionSnapshot["messages"][number];
function assistant(id: string, parentID = "prompt", aborted = true): Message {
  return { info: {
    id, parentID, sessionID: "chat", role: "assistant", time: { created: 2, completed: 3 },
    providerID: "test", modelID: "test", agent: "build", mode: "build", path: { cwd: "/project", root: "/project" },
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(aborted ? { error: { name: "MessageAbortedError", data: { message: "Aborted" } } } : {}),
  }, parts: [] };
}
function note(legacy = false): Message {
  return { info: {
    id: "reason", sessionID: "chat", role: "user", time: { created: 4 }, agent: "build", model: { providerID: "test", modelID: "test" },
  }, parts: [{
    id: "reason-part", messageID: "reason", sessionID: "chat", type: "text", synthetic: true,
    text: "Stopped because identical invalid calls to fixture continued for three assistant steps after correction guidance. Internal field details.",
    ...(legacy ? {} : { metadata: { legalworkStop: { reason: "repeated-invalid-tool-calls", messageID: "failed-call" } } }),
  }] };
}
function snapshot(messages: Message[]): LegalworkSessionSnapshot {
  return { session: { id: "chat", title: "Stop explanation", version: "1", time: { created: 1, updated: 5 } }, messages, todos: [], status: { type: "idle" } };
}
function texts(messages: UIMessage[]) {
  return messages.flatMap((message) => message.parts.flatMap((part) => part.type === "text" ? [part.text] : []));
}

test("reload explains automatic stops, hides internal guidance and preserves later manual stops", () => {
  for (const legacy of [false, true]) {
    const messages = snapshotToUIMessages(snapshot([
      assistant("failed-call", "prompt", false), assistant("aborted"), note(legacy), assistant("manual", "follow-up"),
    ]));
    expect(texts(messages)).toEqual([t("chat.stopped_invalid_tool_calls"), "Stopped"]);
    expect(messages.filter((message) => message.id.includes("aborted"))).toHaveLength(1);
    expect(texts(messages).join(" ")).not.toContain("Internal field details");
  }
});

test("a stop note only labels an abort belonging to the failed call's turn", () => {
  const messages = snapshotToUIMessages(snapshot([
    assistant("failed-call", "first-prompt", false), assistant("unrelated-abort", "later-prompt"), note(),
  ]));
  expect(texts(messages)).toEqual(["Stopped"]);
});

test("a delayed reason refreshes after the generic abort and reconciles to one explanation", () => {
  const input = { workspaceId: "stop-reason-project", baseUrl: "http://127.0.0.1:1", legalworkToken: "test" };
  const dispose = __createWorkspaceSessionSyncForTest(input);
  const release = trackWorkspaceSessionSync(input, "chat");
  const query = getReactQueryClient();
  const invalidations = spyOn(query, "invalidateQueries");
  try {
    const stopped = assistant("failed-call");
    stopped.parts.push({ id: "step", sessionID: "chat", messageID: "failed-call", type: "step-start" });
    seedSessionState(input.workspaceId, snapshot([stopped]));
    __applySessionSyncEventForTest(input, { type: "session.error", properties: { sessionID: "chat", error: stopped.info.role === "assistant" ? stopped.info.error : undefined } });
    expect(texts(query.getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, "chat")) ?? [])).toEqual(["Stopped"]);
    invalidations.mockClear();
    __applySessionSyncEventForTest(input, { type: "message.part.updated", properties: { part: note().parts[0] } });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: snapshotKey(input.workspaceId, "chat"), exact: true });
    seedSessionState(input.workspaceId, snapshot([stopped, note()]));
    expect(texts(query.getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, "chat")) ?? [])).toEqual([t("chat.stopped_invalid_tool_calls")]);
  } finally { invalidations.mockRestore(); release(); dispose(); query.clear(); }
});
