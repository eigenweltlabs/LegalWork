import { expect, test } from "bun:test";
import { toolProgressGuard } from "./tool-progress-guard.js";
import { LegalWorkToolRecovery } from "./legalwork-tool-recovery.js";

function failure(index: number, input: unknown = { query: "" }, messageID = `message-${index}`) {
  return { event: { type: "message.part.updated", properties: { part: { id: `part-${index}`, sessionID: "child", messageID, type: "tool", tool: "fixture", state: { status: "error", input, error: '[{"code":"too_small","path":["query"],"message":"Invalid input"}]' } } } } };
}
function setup() {
  const stopped: string[] = [];
  const guard = toolProgressGuard(async (_session, reason) => { stopped.push(reason); });
  void guard.definition({ toolID: "fixture" }, { description: 'Supply a non-empty query, for example {"query":"invoice"}.', jsonSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"] } });
  const deliver = async (index: number, input: unknown = { query: "" }, messageID = `message-${index}`) => {
    const next = failure(index, input, messageID);
    await guard.event(next);
    const model = { messages: [{ parts: [next.event.properties.part] }] };
    await guard.messages({}, model);
    return model.messages[0].parts[0].state.error;
  };
  return { ...guard, stopped, deliver };
}
test("gives guidance immediately and allows three recovery steps after the warning", async () => {
  const guard = setup();
  expect(await guard.deliver(1)).toContain('"query":"invoice"');
  await guard.deliver(2);
  expect(await guard.deliver(3)).toContain("three further assistant steps");
  expect(guard.stopped).toHaveLength(0);
  expect(await guard.deliver(4)).toContain("two further assistant steps");
  const fifth = await guard.deliver(5);
  expect(fifth).toContain("Final warning: one retry remains.");
  expect(fifth).toContain("If the next call uses the same tool and arguments and fails validation again, LegalWork will forcibly stop this run.");
  expect(fifth).toContain('"query":"invoice"');
  expect(guard.stopped).toHaveLength(0);
  await guard.deliver(6); await guard.deliver(7);
  expect(guard.stopped).toHaveLength(1);
  expect(guard.stopped[0]).toContain("after correction guidance");
});
test("never stops before correction guidance reaches a model request", async () => {
  const guard = setup();
  for (let index = 0; index < 12; index++) await guard.event(failure(index));
  expect(guard.stopped).toHaveLength(0);
});
test("duplicate events and parallel calls cannot exhaust recovery steps", async () => {
  const guard = setup();
  await guard.deliver(1); await guard.deliver(2); await guard.deliver(3);
  await guard.event(failure(3));
  for (let index = 4; index < 12; index++) await guard.event(failure(index, { query: "" }, "one-parallel-step"));
  expect(guard.stopped).toHaveLength(0);
  await guard.deliver(12); expect(guard.stopped).toHaveLength(0);
  await guard.deliver(13); expect(guard.stopped).toHaveLength(1);
});
test("corrected arguments, successful progress and new user turns reset recovery", async () => {
  const guard = setup();
  await guard.deliver(1); await guard.deliver(2); await guard.deliver(3); await guard.deliver(4);
  await guard.deliver(5, { query: "corrected" });
  await guard.deliver(6); await guard.deliver(7);
  const success = failure(8); success.event.properties.part.state.status = "completed";
  await guard.event(success); await guard.deliver(9); await guard.deliver(10);
  await guard.event({ event: { type: "message.updated", properties: { info: { id: "new-user-turn", sessionID: "child", role: "user" } } } });
  await guard.deliver(11);
  expect(guard.stopped).toHaveLength(0);
});
test("ignores other tools and service errors with valid arguments", async () => {
  const guard = setup();
  for (let index = 0; index < 8; index++) {
    const next = failure(index, { query: "valid" }); next.event.properties.part.state.error = "HTTP 503: temporarily unavailable"; await guard.event(next);
    const other = failure(index); other.event.properties.part.tool = "unknown_tool"; await guard.event(other);
  }
  expect(guard.stopped).toHaveLength(0);
});
test("summary updates to the same user message do not reset recovery", async () => {
  const guard = setup();
  const user = { event: { type: "message.updated", properties: { info: { id: "user-turn", sessionID: "child", role: "user" } } } };
  for (let index = 1; index <= 6; index++) { await guard.event(user); await guard.deliver(index); }
  expect(guard.stopped).toHaveLength(1);
});

test("an automatic stop persists its reason and failed turn after aborting", async () => {
  const calls: { action: string; request: unknown }[] = [];
  const plugin = await LegalWorkToolRecovery({ directory: "/project", client: { session: {
    abort: async (request) => { calls.push({ action: "abort", request }); },
    prompt: async (request) => { calls.push({ action: "prompt", request }); },
  } } });
  await plugin["tool.definition"]({ toolID: "fixture" }, { description: "Supply a non-empty query.", jsonSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"] } });
  for (let index = 1; index <= 6; index++) {
    const next = failure(index);
    await plugin.event(next);
    await plugin["experimental.chat.messages.transform"]({}, { messages: [{ parts: [next.event.properties.part] }] });
  }
  expect(calls.map((call) => call.action)).toEqual(["abort", "prompt"]);
  expect(calls[1].request).toMatchObject({ path: { id: "child" }, query: { directory: "/project" }, body: {
    noReply: true, parts: [{ synthetic: true, metadata: { legalworkStop: { reason: "repeated-invalid-tool-calls", messageID: "message-6" } } }],
  } });
});
