import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { nativeChatResponse, nativeDomainEngine } from "./opencode-plugins/native-domain-engine.test-support.js";
import { projectMessage } from "@legalwork/types/opencode-view";
import { assistantProactivityStore } from "./assistant-proactivity-store.js";
import { processAssistantEvents } from "./assistant-proactivity.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary)("released engine: Assistant owns its scratchpad, offers one briefing, and privately decides before one visible update", async () => {
  if (!binary) throw new Error("A released engine is required");
  const previousDB = process.env.OPENCODE_DB;
  let sequence = 0, toolStep = 0;
  const calls = [
    { name: "legalwork_assistant_scratchpad", input: {} },
    { name: "legalwork_assistant_scratchpad", input: { text: "Tell the user when Alex sends the Aster signature page. Remove once received.", revision: 0 } },
    { name: "legalwork_assistant_briefing", input: { action: "status" } },
    { name: "legalwork_assistant_briefing", input: { action: "offer" } },
    { name: "legalwork_assistant_briefing", input: { action: "offer" } },
    { name: "legalwork_assistant_briefing", input: { action: "decline" } },
  ];
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = z.object({ stream: z.boolean().optional(), tools: z.array(z.unknown()).optional(), messages: z.array(z.unknown()) }).parse(await request.json());
    if (JSON.stringify(body.messages).includes("Privately decide")) {
      const reply = '{"notify":true,"message":"Alex sent the signature page."}';
      if (body.stream) {
        const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "decision", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        return new Response(chunk({ role: "assistant", content: reply }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ id: "private-decision", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, message: { role: "assistant", content: '{"notify":true,"message":"Alex sent the signature page."}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    return nativeChatResponse(body.tools?.length ? calls[toolStep++] : undefined, sequence++);
  } });
  let engine: Awaited<ReturnType<typeof nativeDomainEngine>> | undefined;
  try {
    engine = await nativeDomainEngine({ binary, scopedRuntime: true, plugins: [join(import.meta.dir, "opencode-plugins/legalwork-assistant-tools.ts")], modelURL: model.url.origin + "/v1",
      configuration: { permissions: [{ action: "*", resource: "*", effect: "allow" }] },
      async setup(config, root) {
        config.workspaces[0].preset = "main-assistant";
        config.projectsDirectory = join(root, "projects");
        config.managedEngineStorageDirectory = join(root, "isolated-engine");
        process.env.OPENCODE_DB = join(root, "engine.db");
      },
    });
    const { appClient, client, location, config, serverURL } = engine;
    const session = await appClient.session.create({ location, agent: "build" });
    await appClient.session.prompt({ sessionID: session.id, text: "Let me know when Alex sends the signature page. No morning briefing, thanks." });
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(45_000) });
    const history = await client.session.context({ sessionID: session.id });
    const tools = history.flatMap(message => message.type === "assistant" ? message.content.filter(part => part.type === "tool") : []);
    expect(tools.map(tool => tool.state.status), JSON.stringify(history)).toEqual(calls.map(() => "completed"));
    const outputs = tools.map(tool => tool.state.status === "completed" ? JSON.parse(tool.state.content.flatMap(part => part.type === "text" && part.text.startsWith("{") ? [part.text] : []).join("\n")) : null);
    expect(outputs[0].scratchpad.text).toBe("");
    expect(outputs[1].scratchpad.revision).toBe(1);
    expect(outputs[2].task).toBeNull();
    expect(outputs[3].mayOffer).toBe(true);
    expect(outputs[4].mayOffer).toBe(false);
    const call = (path: string, body: unknown) => fetch(serverURL + path, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const origin = { workspaceId: "matter", sessionId: session.id, sourceSessionId: session.id };
    expect((await (await call("/assistant/briefing", { ...origin, action: "status" })).json()).offer.state).toBe("declined");
    expect((await call("/assistant/briefing", { ...origin, action: "create", time: "08:30", weekdaysOnly: true })).status).toBe(400);
    const created = await (await call("/assistant/briefing", { ...origin, action: "create", time: "08:30", weekdaysOnly: true, userAccepted: true })).json();
    const duplicate = await (await call("/assistant/briefing", { ...origin, action: "create", time: "08:30", weekdaysOnly: true, userAccepted: true })).json();
    expect(created.task.id).toBe(duplicate.task.id);
    expect(created.task.schedule.rrule).toContain("BYDAY=MO,TU,WE,TH,FR");
    const child = await client.session.create({ location, parentID: session.id, agent: "build" });
    expect((await call("/assistant/scratchpad", { workspaceId: "matter", sessionId: child.id, sourceSessionId: child.id, text: "worker overwrite", revision: 1 })).status).toBe(403);
    const before = await client.session.context({ sessionID: session.id });
    const decision = await client.session.generate({ sessionID: session.id, prompt: "Privately decide if the signature arrival deserves an update. Return JSON." });
    expect(JSON.parse(decision.text).notify).toBe(true);
    expect(await client.session.context({ sessionID: session.id })).toEqual(before);
    const input = { sessionID: session.id, id: "msg_proactivity_fixture", text: "Deliver the update you chose: Alex sent the signature page.", description: "Assistant update", metadata: { legalworkSystemReminder: true } };
    await client.session.synthetic(input);
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) });
    await client.session.synthetic(input);
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) });
    const after = await client.session.context({ sessionID: session.id });
    expect(after.filter(message => message.id === input.id)).toHaveLength(1);
    expect(after.filter(message => message.type === "assistant")).toHaveLength(before.filter(message => message.type === "assistant").length + 1);
    const synthetic = after.find(message => message.id === input.id);
    if (!synthetic) throw new Error("Missing delivery");
    expect(projectMessage(session.id, synthetic)).toEqual([]);

    const store = await assistantProactivityStore(config);
    const events = Array.from({ length: 45 }, (_, index) => ({ id: `arrival-${index}`, source: "gmail", projectId: null, at: index, text: `Signature page ${index} arrived.` }));
    store.ingest("gmail", "45", events);
    const scored: string[] = [];
    let decisions = 0, deliveries = 0;
    await processAssistantEvents(store, {
      allowed: async () => true,
      classify: async (_, batch) => {
        scored.push(...batch.map(event => event.id));
        return Object.fromEntries(batch.map(event => [event.id, 0.9]));
      },
      decide: async (_, combined) => {
        decisions++;
        expect(scored).toEqual(events.map(event => event.id));
        expect(combined).toEqual(events.map(event => ({ ...event, relevanceProbability: 0.9 })));
        const result = await client.session.generate({ sessionID: session.id, prompt: `Privately decide on these combined events after all scoring has finished: ${JSON.stringify(combined)}` });
        return z.object({ notify: z.boolean(), message: z.string() }).parse(JSON.parse(result.text));
      },
      deliver: async (combined, message, revision) => {
        deliveries++;
        const receipt = store.prepareDelivery(combined.map(event => event.id), "msg_combined_fixture", session.id, message, revision);
        await client.session.synthetic({ sessionID: receipt.sessionId, id: receipt.id, text: message, description: "Assistant update", metadata: { legalworkSystemReminder: true } });
        return true;
      },
    });
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) });
    expect([decisions, deliveries]).toEqual([1, 1]);
    expect(store.pending()).toEqual([]);
    const combinedHistory = await client.session.context({ sessionID: session.id });
    expect(combinedHistory.filter(message => message.id === "msg_combined_fixture")).toHaveLength(1);
    expect(combinedHistory.filter(message => message.type === "assistant")).toHaveLength(after.filter(message => message.type === "assistant").length + 1);
  } finally {
    await engine?.close(); model.stop(true);
    if (previousDB === undefined) delete process.env.OPENCODE_DB; else process.env.OPENCODE_DB = previousDB;
  }
}, 120_000);
