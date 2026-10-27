import { expect, test } from "bun:test";
import { OpenCode } from "@opencode/client";
import { assistantEngineClient } from "./assistant-engine.js";
import { nativeChatResponse, nativeDomainEngine } from "./opencode-plugins/native-domain-engine.test-support.js";

const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
const session = { id: "session", projectID: "project", location: { directory: "/project" }, model: { providerID: "fixture", id: "model" }, cost: 0, tokens, time: { created: 1, updated: 1 } };

test("Assistant uses only native admission, retains identity and hidden context, and pages across the human boundary", async () => {
  const requests: Array<{ method: string; url: URL; body: unknown }> = [];
  const engine = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url), body: unknown = request.body ? await request.json() : null;
    requests.push({ method: request.method, url, body });
    if (url.pathname === "/api/session/session/model" || url.pathname === "/api/session/session/agent") return new Response(null, { status: 204 });
    if (url.pathname === "/api/session/session/prompt") return Response.json({ data: { id: "human", type: "user", time: { created: 1 }, text: "Find the source", delivery: "queue" } });
    if (url.pathname === "/api/session/session") return Response.json({ data: session });
    if (url.pathname === "/api/session/session/message") return Response.json({ data: url.searchParams.has("cursor")
      ? [{ id: "human", type: "user", text: "Find the source", time: { created: 1 }, metadata: { legalworkPrompt: { visibleText: "Find the source", reminders: ["private runtime hint"] } } }]
      : [{ id: "reply", type: "assistant", agent: "legalwork", model: session.model, time: { created: 2, completed: 3 }, finish: "stop", content: [{ type: "text", text: "Complete answer" }] }], cursor: { next: url.searchParams.has("cursor") ? null : "older", previous: null } });
    return new Response("Unexpected native operation", { status: 500 });
  } });
  const client = assistantEngineClient(OpenCode.make({ baseUrl: engine.url.origin }), "/project");
  try {
    await client.session.promptAsync({ sessionID: "session", messageID: "human", agent: "legalwork", model: { providerID: "fixture", modelID: "model" }, parts: [
      { type: "text", text: "Find the source", metadata: { legalworkAssistantSender: "mobile" } }, { type: "text", text: "private runtime hint", synthetic: true },
    ] }, { throwOnError: true });
    expect(requests.find(row => row.url.pathname.endsWith("/prompt"))?.body).toMatchObject({ id: "human", text: "Find the source\n\nprivate runtime hint", delivery: "queue", resume: true,
      metadata: { legalworkAssistantSender: "mobile", legalworkPrompt: { visibleText: "Find the source", reminders: ["private runtime hint"] } } });
    const history = await client.session.messages({ sessionID: "session", limit: 1 }, { throwOnError: true });
    expect(history.data?.[0].info.parentID).toBe("human");
    expect(history.data?.[0].parts).toMatchObject([{ type: "text", text: "Complete answer" }]);
    expect(requests.filter(row => row.url.pathname.endsWith("/message"))).toHaveLength(2);
    expect(requests.every(row => row.url.pathname.startsWith("/api/"))).toBe(true);
  } finally { engine.stop(true); }
});

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary)("released v2 runs the local Assistant reaction tool and returns its reply through the app proxy", async () => {
  let turns = 0;
  const provider = Bun.serve({ port: 0, fetch() {
    return nativeChatResponse(turns++ === 0 ? { name: "legalwork_assistant_react", input: { emoji: "👀" } } : undefined, turns);
  } });
  const fixture = await nativeDomainEngine({ binary: binary!, plugins: [new URL("./opencode-plugins/legalwork-assistant-tools.ts", import.meta.url).pathname], modelURL: provider.url.origin + "/v1",
    setup: async (config, root) => { config.projectsDirectory = root; config.workspaces[0].preset = "main-assistant"; },
  });
  try {
    const client = assistantEngineClient(fixture.appClient, fixture.directory);
    const created = await client.session.create({ title: "Native Assistant smoke" }, { throwOnError: true });
    const sessionID = created.data!.id;
    await client.session.promptAsync({ sessionID, messageID: "msg_native_assistant_smoke", agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Look into my request and reply." }] }, { throwOnError: true });
    let rows = (await client.session.messages({ sessionID }, { throwOnError: true })).data!;
    for (let i = 0; i < 300; i++) {
      rows = (await client.session.messages({ sessionID, limit: 100 }, { throwOnError: true })).data!;
      if (rows.some(row => row.parts.some(part => part.type === "text" && part.text === "Fixture checked."))) break;
      await Bun.sleep(50);
    }
    const reaction = rows.flatMap(row => row.parts).find(part => part.type === "tool" && part.tool === "legalwork_assistant_react");
    expect(reaction).toMatchObject({ type: "tool", state: { status: "completed" } });
    if (reaction?.type !== "tool" || reaction.state.status !== "completed") throw new Error("Native reaction did not complete.");
    expect(reaction.state.output).toContain('"messageId":"msg_native_assistant_smoke"');
    expect(reaction.state.output).toContain('"emoji":"👀"');
    expect(rows.at(-1)?.parts).toMatchObject(expect.arrayContaining([expect.objectContaining({ type: "text", text: "Fixture checked." })]));
    expect(turns).toBe(2);
  } finally { await fixture.close(); provider.stop(true); }
}, 45_000);
