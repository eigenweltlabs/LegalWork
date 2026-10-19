import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { mcpManager } from "./mcp-manager.js";
import { runtimeMcpMapForWorkspace } from "./mcp.js";
import { closeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { connectorRuntimeCapability } from "./connectors/capability.js";
import { createMcpOAuthCallbackBroker } from "../../desktop/electron/mcp-oauth-callback.mjs";
import type { ServerConfig } from "./types.js";

const binary = process.env.OPENCODE_TEST_BINARY;
if (binary && !existsSync(binary)) throw new Error("OPENCODE_TEST_BINARY does not exist");
function freePort() { const s = Bun.serve({ port: 0, fetch: () => new Response() }); const port = s.port; s.stop(true); if (!port) throw new Error("No port"); return port; }
async function until(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 150; i++) { if (await check().catch(() => false)) return; await Bun.sleep(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once("exit", () => done())); child.kill("SIGKILL"); await exited;
}
const statsSchema = z.object({ authorizationGrants: z.number(), refreshGrants: z.number(), rejectedRefreshGrants: z.number(), revokedFamilies: z.number() });
const statusSchema = z.record(z.string(), z.object({ status: z.string() }));

test.skipIf(!binary)("unmodified engines share server OAuth across workspaces, rebuilds, refresh and logout", async () => {
  if (!binary) throw new Error("Missing engine binary");
  const root = await mkdtemp(join(tmpdir(), "legalwork-manager-engines-"));
  const children: ChildProcess[] = [];
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const callback = createMcpOAuthCallbackBroker();
  const providerPort = freePort(), callbackPort = freePort();
  const providerUrl = `http://127.0.0.1:${providerPort}`;
  const provider = spawn("node", [resolve(import.meta.dir, "../../../scripts/mock-oauth-mcp-server.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(providerPort), ISSUER: providerUrl, AUTO_APPROVE: "1", DYNAMIC_REGISTRATION: "1", CLIENT_ID: "", CLIENT_SECRET: "",
      ACCESS_TOKEN_TTL_SECONDS: "3600", ROTATE_REFRESH_TOKENS: "1", REFRESH_REUSE_REVOKES_FAMILY: "1", REFRESH_DELAY_MS: "400" }, stdio: "ignore",
  });
  children.push(provider);
  const captures: Array<{ tools: string[]; results: string[] }> = [];
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]), messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })) }).parse(await request.json());
    const tools = input.tools.map(item => item.function.name);
    const results = input.messages.filter(item => item.role === "tool").map(item => JSON.stringify(item.content));
    if (tools.length) captures.push({ tools, results });
    const call = tools.includes("shared_mock_echo") && !results.some(item => item.includes("GATEWAY_TOOL_OK"));
    const delta = call ? { tool_calls: [{ index: 0, id: "call_shared", type: "function", function: { name: "shared_mock_echo", arguments: JSON.stringify({ text: "GATEWAY_TOOL_OK" }) } }] } : { content: "Connector check complete." };
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "gateway-check", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const workspaces = ["a", "b"].map(id => ({ id: `ws_${id}`, name: id, path: join(root, id), baseUrl: `http://127.0.0.1:${freePort()}`, preset: "starter", workspaceType: "local" } satisfies ServerConfig["workspaces"][number]));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "app-token", hostToken: "host-token", configPath: join(root, "server.json"), mcpVaultKey: () => Buffer.alloc(32, 8),
    workspaces, approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], authorizedRoots: [root], readOnly: false,
    startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const baseEngineConfig = {
    plugin: [pathToFileURL(resolve(import.meta.dir, "opencode-plugins/legalwork-mcp-gateway.ts")).href],
    permission: { "*": "allow" },
    provider: { local: { npm: "@ai-sdk/openai-compatible", name: "Local fixture", options: { baseURL: `${model.url.origin}/v1`, apiKey: "synthetic" }, models: { local: { name: "Local", limit: { context: 128000, output: 4096 } } } } },
    enabled_providers: ["local"], model: "local/local", small_model: "local/local", share: "disabled", autoupdate: false, lsp: false, formatter: false,
  };
  const engineRequest = async (index: number, path: string, body?: unknown) => {
    const workspace = workspaces[index]; if (!workspace) throw new Error("Missing workspace");
    const url = new URL(path, workspace.baseUrl); url.searchParams.set("directory", workspace.path);
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`Engine ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const app = async (workspace: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", extraHeaders: Record<string, string> = {}) => {
    if (!server) throw new Error("Missing server");
    const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspace}${path}`, {
      method, headers: { Authorization: `Bearer ${config.token}`, "content-type": "application/json", ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`App ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const stats = async () => statsSchema.parse(await (await fetch(`${providerUrl}/stats`)).json());
  const signIn = async (rebuild = false) => {
    const listener = await callback.listen({ redirectUri: `http://127.0.0.1:${callbackPort}/mcp/oauth/callback` });
    const flow = z.object({ authorizationUrl: z.string() }).parse(await app("ws_a", "/opencode/mcp/shared/auth", {}));
    const state = new URL(flow.authorizationUrl).searchParams.get("state"); if (!state) throw new Error("No state");
    const received = callback.wait({ listenerId: listener.listenerId, state });
    if (rebuild) await Promise.all([engineRequest(0, "/instance/dispose", {}), engineRequest(1, "/instance/dispose", {})]);
    const consent = await fetch(flow.authorizationUrl, { redirect: "manual" });
    const redirect = consent.headers.get("location"); if (!redirect) throw new Error("Missing callback");
    expect((await fetch(redirect)).ok).toBe(true);
    expect(await app("ws_a", "/opencode/mcp/shared/auth/callback", await received, "POST", { "x-legalwork-oauth-state": state })).toEqual({ status: "connected" });
    await callback.close();
  };
  try {
    await until(async () => z.object({ issuer: z.string() }).parse(await (await fetch(`${providerUrl}/health`)).json()).issuer === providerUrl, "provider");
    await Promise.all(workspaces.map(workspace => mkdir(workspace.path)));
    server = await startServer(config);
    for (const workspace of workspaces) {
      await writeFile(join(workspace.path, "opencode.jsonc"), JSON.stringify(baseEngineConfig));
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_") || key.startsWith("LEGALWORK_")) delete env[key];
      const engine = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", new URL(workspace.baseUrl).port], {
        cwd: workspace.path, env: { ...env, OPENCODE_CONFIG: join(workspace.path, "opencode.jsonc"), OPENCODE_CONFIG_CONTENT: "", OPENCODE_CONFIG_DIR: join(root, "policy"),
          LEGALWORK_SERVER_URL: `http://127.0.0.1:${server.port}`, LEGALWORK_CONNECTOR_TOKEN: connectorRuntimeCapability(config),
          OPENCODE_TEST_HOME: join(root, "home"), OPENCODE_DB: join(root, `${workspace.id}.sqlite`), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "1" }, stdio: "ignore",
      });
      children.push(engine);
      await until(async () => (await fetch(`${workspace.baseUrl}/global/health`)).ok, "engine");
    }
    await app("ws_a", "/mcp", { name: "shared", config: { type: "remote", url: `${providerUrl}/mcp`, enabled: true, oauth: { callbackPort } } });
    await signIn(true);
    expect((await stats()).authorizationGrants).toBe(1);
    for (const index of [0, 1]) expect(statusSchema.parse(await engineRequest(index, "/mcp")).shared?.status).toBe("connected");
    const manager = mcpManager(config); if (!manager) throw new Error("Missing manager");
    const gatewayEntries = await manager.engineEntries("ws_a", await runtimeMcpMapForWorkspace(config, "ws_a"));
    const runtimeHeaders = z.record(z.string(), z.string()).parse(gatewayEntries.shared?.headers);
    expect((await fetch(`http://127.0.0.1:${server.port}/workspace/ws_a/mcp/shared/auth`, { method: "DELETE", headers: runtimeHeaders })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${server.port}/internal/mcp/config?directory=${encodeURIComponent(workspaces[0]!.path)}`, { headers: runtimeHeaders })).status).toBe(401);
    for (const workspace of workspaces) {
      const mcp = await manager.engineEntries(workspace.id, await runtimeMcpMapForWorkspace(config, workspace.id));
      expect(mcp.shared?.oauth).toBe(false);
    }
    const engineConfig = z.object({ mcp: z.record(z.string(), z.object({ url: z.string(), oauth: z.literal(false) })) });
    for (const index of [0, 1]) expect(engineConfig.parse(await engineRequest(index, "/config")).mcp.shared?.url).toContain(`/mcp/gateway/${workspaces[index]?.id}/`);
    await fetch(`${providerUrl}/expire`, { method: "POST" });
    const resources = await Promise.all([engineRequest(0, "/experimental/resource"), engineRequest(1, "/experimental/resource")]);
    expect(JSON.stringify(resources)).toContain("mock://resource");
    expect(await stats()).toMatchObject({ refreshGrants: 1, rejectedRefreshGrants: 0, revokedFamilies: 0 });
    await Promise.all(workspaces.map(async (_, index) => {
      const session = z.object({ id: z.string() }).parse(await engineRequest(index, "/session", { title: "Gateway tool fixture" }));
      await engineRequest(index, `/session/${session.id}/message`, { model: { providerID: "local", modelID: "local" }, parts: [{ type: "text", text: "Run the shared echo connector." }] });
    }));
    expect(captures.filter(item => item.results.some(result => result.includes("GATEWAY_TOOL_OK"))).length).toBeGreaterThanOrEqual(2);
    await Promise.all([engineRequest(0, "/instance/dispose", {}), engineRequest(1, "/instance/dispose", {})]);
    await syncAllWorkspacesRuntimeMcpToEngine(config);
    for (const index of [0, 1]) expect(statusSchema.parse(await engineRequest(index, "/mcp")).shared?.status).toBe("connected");
    for (const index of [0, 1]) expect(engineConfig.parse(await engineRequest(index, "/config")).mcp.shared?.url).toContain(`/mcp/gateway/${workspaces[index]?.id}/`);
    expect((await stats()).authorizationGrants).toBe(1);
    const engineAuth = await readFile(join(root, "data/opencode/mcp-auth.json"), "utf8").catch(() => "{}");
    expect(JSON.parse(engineAuth)).toEqual({});
    await fetch(`${providerUrl}/expire`, { method: "POST" });
    const pending = engineRequest(0, "/experimental/resource").catch(() => null);
    await until(async () => (await stats()).refreshGrants === 2, "refresh before logout");
    await app("ws_b", "/mcp/shared/auth", undefined, "DELETE");
    await pending;
    await Bun.sleep(450);
    expect(manager.store.all()[0]?.tokens).toBeUndefined();
    for (const workspace of workspaces) expect(statusSchema.parse(await app(workspace.id, "/opencode/mcp")).shared?.status).toBe("needs_auth");
    await signIn();
    expect((await stats()).authorizationGrants).toBe(2);
  } finally {
    await callback.close();
    await Promise.all(children.map(stop));
    await server?.stop();
    await closeRuntimeOpencodeConfig(config);
    model.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
