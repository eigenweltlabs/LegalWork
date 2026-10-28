import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const mode = z.enum(["fixed", "recover", "transport-fixed"]).parse(process.env.SUPPORT_AGENT_MODE ?? "fixed");
const toolCase = z.enum(["saved-output", "native", "mcp", "word"]).parse(process.env.SUPPORT_AGENT_CASE ?? "saved-output");
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
if (!binary) throw new Error("Set LEGALWORK_TEST_OPENCODE_BIN to the OpenCode binary to test.");
const output = process.env.SUPPORT_REPRO_DIR;
if (!output) throw new Error("Set SUPPORT_REPRO_DIR.");
const root = join(output, `agent-${mode}`), project = join(root, "project");
await mkdir(project, { recursive: true });
const message = z.object({ role: z.string(), content: z.unknown() }).passthrough();
const requestSchema = z.object({ messages: z.array(message), tools: z.array(z.object({ function: z.object({ name: z.string() }).passthrough() }).passthrough()).optional() }).passthrough();
const requests: { child: boolean; tools: string[]; step: number; recoveryWarning?: boolean; finalRecoveryWarning?: boolean }[] = [];
let invalidCalls = 0;
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const address = new URL(request.url);
  if (address.pathname === "/mcp") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const rpc = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() }).parse(await request.json());
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    const result = rpc.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : rpc.method === "tools/list" ? { tools: [{ name: "large_output", description: "Produce the synthetic saved output to inspect", inputSchema: { type: "object", properties: {} } }, { name: "validate", description: "Synthetic argument validation: supply an integer limit of at least 1.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1 } }, required: ["limit"] } }] }
      : toolCase === "mcp" ? { isError: true, content: [{ type: "text", text: "MCP error -32602: limit must be an integer of at least 1" }] } : { content: [{ type: "text", text: JSON.stringify({ padding: "a".repeat(80000), verification_marker: "SUPPORT_AGENT_TAIL_748261" }) }] };
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  }
  const input = requestSchema.parse(await request.json());
  if (mode.startsWith("transport")) { requests.push({child:false,tools:[],step:requests.length+1}); return Response.json({error:{code:requests.length>8?"fixture_stop":"request_too_large",message:"Request body too large",max_request_bytes:31457280}},{status:requests.length>8?400:413}); }
  const tools = input.tools?.map(tool => tool.function.name) ?? [];
  const child = input.messages.some(item => item.role === "user" && JSON.stringify(item.content).includes("CHILD_GUARD"));
  const recoveryWarning = input.messages.some(item => item.role === "tool" && JSON.stringify(item.content).includes("three further assistant steps"));
  const finalRecoveryWarning = input.messages.some(item => item.role === "tool" && JSON.stringify(item.content).includes("Final warning: one retry remains."));
  requests.push({ child, tools, step: requests.length + 1, recoveryWarning, finalRecoveryWarning });
  const results = input.messages.filter(item => item.role === "tool");
  const failing = child && invalidCalls < 12 && !(mode === "recover" && recoveryWarning);
  if (failing) invalidCalls++;
  const call = !tools.length ? undefined : failing
    ? toolCase === "word" ? { name: "inapp_docx_read_document", arguments: JSON.stringify({ path: "test-file.docx", view: "invalid-test-view" }) } : toolCase === "native" ? { name: "read", arguments: JSON.stringify({ filePath: 42 }) } : toolCase === "mcp" ? { name: "fixture_validate", arguments: JSON.stringify({ limit: 0 }) } : { name: "legalwork_tool_output_read", arguments: JSON.stringify({ outputPath: "" }) }
    : !child && tools.includes("task") && !results.length
      ? { name: "task", arguments: JSON.stringify({ description: "Check the argument-loop guard", subagent_type: "general", prompt: "CHILD_GUARD: exercise the synthetic invalid-input tool fixture." }) } : undefined;
  const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: `fixture_${requests.length}`, type: "function", function: call }] } : { content: recoveryWarning ? "Fixture accepted correction guidance and changed approach." : "The child fixture has settled." }) }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
} });
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port; reservation.stop(true);
const plugin = resolve(import.meta.dir, "../dist/opencode-plugins/legalwork-tool-output.js");
const tracePlugin = join(root, "trace.mjs");
await writeFile(tracePlugin, `import {appendFile} from 'node:fs/promises';
export const Trace = async () => ({"tool.definition": async ({toolID},output) => {
 if (["read","legalwork_tool_output_read","inapp_docx_read_document"].includes(toolID)) await appendFile(${JSON.stringify(join(root, "definitions.jsonl"))}, JSON.stringify({toolID, keys:Object.keys(output), parameters:output.parameters, jsonSchema:output.jsonSchema})+'\\n');
},event: async ({event}) => {
  const part = event.properties?.part;
  if (['message.updated', 'session.idle', 'session.status'].includes(event.type) || part?.state?.status === 'error') await appendFile(${JSON.stringify(join(root, "events.jsonl"))}, JSON.stringify(event)+'\\n');
}});`);
const config = join(root, "config.json");
await writeFile(config, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
  provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Synthetic fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Synthetic fixture", limit: { context: 200000, output: 4000 } } } } },
  plugin: [pathToFileURL(plugin).href, ...(toolCase === "word" ? [pathToFileURL(resolve(import.meta.dir, "../dist/opencode-plugins/legalwork-extensions-preview.js")).href] : []), pathToFileURL(resolve(import.meta.dir, "../dist/opencode-plugins/legalwork-tool-recovery.js")).href, pathToFileURL(tracePlugin).href, ...(mode === "transport-fixed" ? [pathToFileURL(resolve(import.meta.dir,"../dist/opencode-plugins/legalwork-openai-tool-call-ids.js")).href] : [])], permission: { legalwork_tool_output_read: "allow", legalwork_tool_output_search: "allow", read: "allow", task: "allow", fixture_large_output: "allow", fixture_validate: "allow", inapp_docx_read_document: "allow" },
  ...(toolCase === "mcp" ? { mcp: { fixture: { type: "remote", url: fixture.url.origin + "/mcp", oauth: false } } } : {}), lsp: false, formatter: false,
}));
const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project,
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_") && !key.startsWith("LEGALWORK_"))),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: config, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
  }, stdout: "ignore", stderr: "pipe" });
const stderr = new Response(engine.stderr).text();
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Startup. */ }
    if (ready || engine.exitCode !== null) break;
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Isolated engine failed to start.");
  const session = z.object({ id: z.string() }).parse(await (await fetch(base + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json());
  const started = performance.now();
  const response = await fetch(`${base}/session/${session.id}/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: "build", parts: [{ type: "text", text: "Delegate a general child to exercise the argument-loop guard. Report when the child finishes or is cancelled." }] }), signal: AbortSignal.timeout(60000) });
  await response.text();
  const children = z.array(z.object({ id: z.string() })).parse(await (await fetch(`${base}/session/${session.id}/children`)).json());
  const sessions = [];
  for (const id of [session.id, ...children.map(child => child.id)]) sessions.push({ id, messages: await (await fetch(`${base}/session/${id}/message`)).json() });
  const report = { mode, toolCase, status: response.status, elapsedMs: Math.round(performance.now() - started), invalidCalls, requests, sessions };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, status: response.status, elapsedMs: report.elapsedMs, invalidCalls, modelRequests: requests.length, childSessions: children.length, report: join(root, "report.json") }));
} finally { engine.kill("SIGKILL"); await engine.exited; fixture.stop(true); await writeFile(join(root, "engine-stderr.txt"), await stderr); }
