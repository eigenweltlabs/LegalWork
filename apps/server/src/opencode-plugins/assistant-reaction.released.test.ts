import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { z } from "zod";
import { nativeChatResponse, nativeDomainEngine } from "./native-domain-engine.test-support.js";
import { ASSISTANT_REACTION_POLICY } from "./legalwork-assistant-tools.js";
import { assistantEngineClient } from "../assistant-engine.js";

test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("a first-action reaction is directly available and succeeds in the released engine", async () => {
  const requests: string[][] = [];
  const prompts: string[] = [];
  const model = Bun.serve({ port: 0, async fetch(request) {
    const body = z.object({ messages: z.array(z.unknown()), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]) }).parse(await request.json());
    if (!body.tools.length) return nativeChatResponse(undefined, 0);
    requests.push(body.tools.map(tool => tool.function.name));
    prompts.push(JSON.stringify(body.messages));
    return nativeChatResponse(requests.length === 1 ? { name: "legalwork_assistant_react", input: { emoji: "😊" } } : undefined, requests.length);
  } });
  let host: Awaited<ReturnType<typeof nativeDomainEngine>> | undefined;
  try {
    host = await nativeDomainEngine({ binary: process.env.LEGALWORK_TEST_OPENCODE_BIN!, modelURL: model.url.origin + "/v1", directTools: false,
      plugins: [resolve(import.meta.dir, "legalwork-assistant-tools.ts")],
      configuration: { agents: { legalwork: { mode: "primary" } }, permissions: [{ action: "*", resource: "*", effect: "allow" }] },
      setup: async config => { config.workspaces[0].preset = "main-assistant"; },
    });
    const session = await host.appClient.session.create({ location: host.location, agent: "legalwork", model: { providerID: "fixture", id: "fixture" } });
    const admission = await host.appClient.session.prompt({ sessionID: session.id, text: "Hi, good morning!" });
    await host.appClient.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20000) });
    expect(requests[0]).toContain("legalwork_assistant_react");
    expect(prompts[0]).toContain(JSON.stringify(ASSISTANT_REACTION_POLICY).slice(1, -1));
    const history = await assistantEngineClient(host.appClient, host.directory).session.messages({ sessionID: session.id });
    const reaction = history.data?.flatMap(message => message.parts).find(part => part.type === "tool" && part.tool === "legalwork_assistant_react");
    if (reaction?.type !== "tool" || reaction.state.status !== "completed") throw new Error("Reaction did not complete");
    expect(JSON.parse(reaction.state.output)).toEqual({ ok: true, reaction: { emoji: "😊", messageId: admission.id } });
  } finally { await host?.close(); model.stop(true); }
}, 60000);
