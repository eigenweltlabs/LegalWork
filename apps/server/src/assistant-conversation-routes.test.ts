import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantConversations } from "./assistant-conversations.js";
import { AssistantSubmissions, type SubmissionPayload } from "./assistant-submissions.js";
import { registerAssistantConversationRoutes } from "./routes/assistant-conversations.js";
import { matchRoute, type Route, type RequestContext } from "./routes/registry.js";

test("concurrent project-command retries reuse one destination and its original payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "assistant-command-route-"));
  const assistant = { id: "assistant", path: "/fixture/assistant", preset: "main-assistant" };
  const project = { id: "matter", path: "/fixture/matter" };
  let created = 0, sends = 0, stored = false;
  const payloads: SubmissionPayload[] = [];
  try {
    const conversations = await AssistantConversations.open(join(root, "runtime.sqlite"), () => []);
    const conversation = await conversations.create(assistant, { create: async title => ({ id: "origin", title, directory: assistant.path, time: {} }) });
    const submissions = await AssistantSubmissions.open(join(root, "runtime.sqlite"), {
      hasMessage: async () => stored, outcome: async () => "running",
      send: async (entry, payload) => {
        expect(entry.workspaceId).toBe("matter"); expect(entry.sessionId).toBe("command-session");
        payloads.push(payload); sends++;
        if (sends === 1) throw new Error("temporary connection loss");
        stored = true;
      },
    });
    const routes: Route[] = [];
    // Minimal HTTP-handler fixture: unrelated services are not started.
    registerAssistantConversationRoutes({ routes, config: { workspaces: [assistant, project] }, conversations, submissions,
      ensureWritable: () => {}, requireClientScope: () => {}, changed: () => {}, assistant: {}, delegations: { track: () => {} },
      jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }), readJsonBodyLimited: (request: Request) => request.json(),
      resolveWorkspace: async (_config: unknown, id: string) => id === "matter" ? project : assistant,
      client: (workspace: typeof project) => ({
        command: { list: async () => ({ data: [{ name: "compare" }] }) },
        session: { get: async () => ({ data: { directory: workspace.path, time: {} } }), messages: async () => ({ data: [] }),
          create: async () => { created++; return { data: { id: "command-session", directory: project.path } }; } },
      }),
    } as unknown as Parameters<typeof registerAssistantConversationRoutes>[0]);
    const route = matchRoute(routes, "POST", `/assistant/conversations/${conversation.id}/messages`)!;
    const input = { requestId: "request_original", messageId: "msg_1234567890abc", text: "/compare original", command: { name: "compare", arguments: "original" },
      context: { items: [], target: { kind: "project", workspaceId: "matter" }, searchScope: null, capturedAt: 1 } };
    const send = async (arguments_: string) => {
      const request = new Request(`http://localhost/assistant/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ ...input, command: { ...input.command, arguments: arguments_ } }) });
      const ctx = { request, url: new URL(request.url), params: { id: conversation.id }, actor: { type: "host" } } as unknown as RequestContext;
      return (await route.handler(ctx)).json();
    };
    expect((await send("original")).submission.state).toBe("unconfirmed");
    const retries = await Promise.all([send("changed"), send("also changed")]);
    expect(retries.every(result => ["accepted", "running"].includes(result.submission.state))).toBe(true);
    expect(created).toBe(1); expect(sends).toBe(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[1].command?.arguments).toBe("original");
  } finally { await rm(root, { recursive: true, force: true }); }
});
