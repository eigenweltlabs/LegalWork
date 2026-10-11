import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission, WorkspaceSessionGroup } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { chatSubagents, SubagentList } from "../src/react-app/domains/session/chat/session-subagents";
import { sidebarSessionGroups } from "../src/react-app/domains/session/sidebar/utils";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { interactionSessionsKey, permissionKey, seedInteractionSessions, type InteractionSessions } from "../src/react-app/domains/session/sync/interaction-state";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest } from "../src/react-app/domains/session/sync/session-sync";

const workspaceId = "subagent-list-tests";
const cache = getReactQueryClient();
afterEach(() => {
  cache.clear();
  useSessionActivityStore.setState({ recordsByWorkspaceId: {}, statusesByWorkspaceId: {} });
});

test("the sidebar hides every descendant, including orphans and archived agents, without changing navigation data", () => {
  const groups: WorkspaceSessionGroup[] = [{
    workspace: { id: workspaceId, name: "Project", path: "/project" }, status: "ready",
    sessions: [
      { id: "parent", title: "Review" },
      { id: "child", parentID: "parent", title: "Research", status: "busy" },
      { id: "nested", parentID: "child", title: "References" },
      { id: "orphan", parentID: "unloaded-parent" },
      { id: "archived-agent", parentID: "parent", time: { archived: 1 } },
      { id: "archived-chat", time: { archived: 1 } },
    ],
  }];
  const visible = sidebarSessionGroups(groups);
  expect(visible[0].sessions.map(session => session.id)).toEqual(["parent", "archived-chat"]);
  expect(groups[0].sessions).toHaveLength(6);
  expect(visible[0].workspace).toBe(groups[0].workspace);
});

test("reopening a chat recovers a flat list of completed and nested agents from the workspace list", () => {
  seedInteractionSessions(workspaceId, [
    { id: "parent", title: "Review" },
    { id: "child", parentID: "parent", title: "Research" },
    { id: "nested", parentID: "child", title: "References" },
    { id: "unrelated", parentID: "another-chat", title: "Other" },
  ]);
  seedInteractionSessions("other-workspace", [{ id: "other-child", parentID: "parent", title: "Other project" }]);
  const sessions = cache.getQueryData<InteractionSessions>(interactionSessionsKey(workspaceId))!;
  expect(chatSubagents("parent", sessions, {})).toEqual([
    { id: "child", parentID: "parent", title: "Research", status: "idle" },
    { id: "nested", parentID: "child", title: "References", status: "idle" },
  ]);
  expect(chatSubagents("child", sessions, {}).map(agent => agent.id)).toEqual(["nested"]);
  expect(chatSubagents("unrelated", sessions, {})).toEqual([]);
  seedInteractionSessions(workspaceId, Object.values(sessions));
  expect(cache.getQueryData(interactionSessionsKey(workspaceId))).toBe(sessions);
});

test("live creation, completion, pending approvals and deletion update the list for unopened agents", () => {
  const input = { workspaceId, baseUrl: "http://127.0.0.1:1", legalworkToken: "fixture" };
  const dispose = __createWorkspaceSessionSyncForTest(input);
  const emit = (type: string, properties: unknown) => __applySessionSyncEventForTest(input, { type, properties });
  const agents = () => chatSubagents("parent", cache.getQueryData<InteractionSessions>(interactionSessionsKey(workspaceId)) ?? {}, useSessionActivityStore.getState().statusesByWorkspaceId[workspaceId] ?? {},
    (cache.getQueryData<PendingPermission[]>(permissionKey(workspaceId, "child")) ?? []).map(request => request.sessionID));
  try {
    emit("session.created", { info: { id: "child", parentID: "parent", title: "Research" } });
    emit("session.status", { sessionID: "child", status: { type: "busy" } });
    expect(agents()[0].status).toBe("thinking");
    emit("permission.asked", { id: "approval", sessionID: "child", permission: "bash", patterns: ["echo example"], metadata: {}, always: [] });
    emit("session.status", { sessionID: "child", status: { type: "idle" } });
    expect(agents()[0].status).toBe("waiting");
    emit("permission.replied", { sessionID: "child", requestID: "approval", reply: "once" });
    expect(agents()[0].status).toBe("idle");
    emit("session.error", { sessionID: "child", error: { name: "UnknownError", data: { message: "Interrupted" } } });
    expect(agents()[0].status).toBe("error");
    emit("session.deleted", { info: { id: "child" } });
    expect(agents()).toEqual([]);
  } finally { dispose(); }
});

test("the header is collapsed by default and summarizes activity without moving approval actions into it", () => {
  expect(renderToStaticMarkup(<SubagentList agents={[]} />)).toBe("");
  const agents = chatSubagents("parent", {
    running: { id: "running", parentID: "parent", title: "Running task" },
    waiting: { id: "waiting", parentID: "parent", title: "Waiting task" },
    failed: { id: "failed", parentID: "parent", title: "Failed task" },
    done: { id: "done", parentID: "parent", title: "Finished task" },
  }, { running: "responding", waiting: "waiting", failed: "error", done: "idle" });
  const html = renderToStaticMarkup(<SubagentList agents={agents} onOpenSession={() => {}} />);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("1 running · 1 waiting · 1 failed");
  expect(html).not.toContain("Running task");
  expect(html).not.toContain("Allow once");
  expect(renderToStaticMarkup(<SubagentList agents={[agents[3]]} />)).toContain("1 completed");
});
