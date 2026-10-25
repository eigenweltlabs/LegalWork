import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startServer } from "../server.js";
import { LegalWorkSandbox } from "../opencode-plugins/legalwork-sandbox.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { writeSandboxDefault } from "./settings.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

// Opt in explicitly: CI stays deterministic; this test contacts the live public index.
test.skipIf(process.env.LEGALWORK_FIRECRAWL_LIVE !== "1")("search_us_law relays through the authenticated LegalWork server to the live keyless index", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "legalwork-gov-live-")));
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN,
    env: process.env.LEGALWORK_ENV_STORE, tokens: process.env.LEGALWORK_TOKEN_STORE, key: process.env.FIRECRAWL_API_KEY };
  process.env.LEGALWORK_ENV_STORE = join(root, "env.json");
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  delete process.env.FIRECRAWL_API_KEY;
  const workspace: WorkspaceInfo = { id: "research", name: "Research", path: root, preset: "starter", workspaceType: "local" };
  // Only engine identity/config lookups are fixtures; the LegalWork HTTP route,
  // permission checks, outbound broker and Firecrawl response are real.
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/session/")) return Response.json({ id: "research-chat", directory: root });
    if (path === "/agent") return Response.json([{ name: "legalwork", permission: [{ permission: "*", pattern: "*", action: "allow" }] }]);
    return Response.json({ permission: { "*": "allow" } });
  } });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "gov-live-client", hostToken: "gov-live-host", configPath: join(root, "server.json"),
    agentSandboxEnabled: true, opencodeBaseUrl: engine.url.origin,
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [root],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await writeSandboxDefault(config, { enabled: false, networkMode: "allow" });
    await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { webfetch: "allow", websearch: "allow" } }));
    server = await startServer(config);
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    process.env.LEGALWORK_SERVER_TOKEN = config.token;
    expect((await fetch(`${process.env.LEGALWORK_SERVER_URL}/workspace/research/sandbox/web`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).status).toBe(401);
    const plugin = await LegalWorkSandbox({ directory: root });
    const result = await plugin.tool.search_us_law.execute({
      query: "California noncompete agreements Business Professions Code 16600", jurisdiction: "us-ca", k: 3,
    }, { sessionID: "research-chat", agent: "legalwork", directory: root, abort: AbortSignal.timeout(45000) });
    const output = z.object({ results: z.array(z.object({ title: z.string(), url: z.string() })).min(1), notice: z.string() }).parse(JSON.parse(result.output));
    expect(result.metadata.provider).toBe("firecrawl");
    expect(output.results.some(hit => new URL(hit.url).hostname === "leginfo.legislature.ca.gov")).toBe(true);
    expect(output.notice).toContain("verify issuer");
    console.info(JSON.stringify({ provider: result.metadata.provider, results: output.results }, null, 2));
  } finally {
    await server?.stop();
    engine.stop(true);
    await closeRuntimeOpencodeConfig(config);
    for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: previous.url, LEGALWORK_SERVER_TOKEN: previous.token,
      LEGALWORK_ENV_STORE: previous.env, LEGALWORK_TOKEN_STORE: previous.tokens, FIRECRAWL_API_KEY: previous.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
