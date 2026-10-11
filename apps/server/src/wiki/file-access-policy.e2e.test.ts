import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server.js";
import { registerLocalProject } from "../routes/workspaces.js";
import { LegalWorkWikiTools } from "../opencode-plugins/legalwork-wiki-tools.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";
import { WikiStore } from "./store.js";
import type { ServerConfig } from "../types.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

test("real file-tool hook protects disabled wikis and unmanaged proxy shell endpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-file-policy-api-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "file-policy-client", hostToken: "file-policy-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, agentSandboxEnabled: false,
  };
  const { workspace } = await registerLocalProject(config, { folderPath: join(root, "project"), name: "Project", preset: "starter" });
  workspace.baseUrl = "http://127.0.0.1:1";
  const store = new WikiStore(config); cleanup.push(() => store.close());
  const wiki = await store.create({ name: "Private disabled wiki", template: "blank" });
  await store.update(wiki.id, { allowInProjects: false });
  const token = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config, { sessionId: "project-session", directory: workspace.path, scope: "owner" });
  await grantWikiAgentSession(config, { sessionId: "wiki-session", directory: wiki.root, scope: "owner" });
  const server = await startServer(config); cleanup.push(async () => { await server.stop(); });
  const base = `http://127.0.0.1:${server.port}`;
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN, agent: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
  process.env.LEGALWORK_SERVER_URL = base; process.env.LEGALWORK_SERVER_TOKEN = config.token; process.env.LEGALWORK_WIKI_AGENT_TOKEN = token;
  cleanup.push(async () => {
    for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: previous.url, LEGALWORK_SERVER_TOKEN: previous.token, LEGALWORK_WIKI_AGENT_TOKEN: previous.agent }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const project = await LegalWorkWikiTools({ directory: workspace.path });
  for (const tool of ["write", "edit"]) {
    await expect(project["tool.execute.before"]({ tool, sessionID: "project-session" }, { args: { filePath: `${wiki.root}/Page.md` } }))
      .rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    await project["tool.execute.before"]({ tool, sessionID: "project-session" }, { args: { filePath: "Draft.md" } });
  }
  await expect(project["tool.execute.before"]({ tool: "apply_patch", sessionID: "project-session" }, { args: { patchText: `*** Begin Patch\n*** Add File: ${wiki.root}/Page.md\n+text\n*** End Patch` } }))
    .rejects.toMatchObject({ code: "wiki_direct_write_denied" });
  await expect(project["tool.execute.before"]({ tool: "bash", sessionID: "project-session" }, { args: { command: "true" } }))
    .rejects.toMatchObject({ code: "wiki_protected_execution_required" });
  const own = await LegalWorkWikiTools({ directory: wiki.root });
  await own["tool.execute.before"]({ tool: "edit", sessionID: "wiki-session" }, { args: { filePath: "Page.md" } });
  await expect(project["tool.execute.before"]({ tool: "read", sessionID: "project-session" }, { args: { filePath: `${wiki.root}/Page.md` } }))
    .rejects.toMatchObject({ code: "wiki_direct_read_denied" });
  await grantWikiAgentSession(config, { sessionId: "private-collaborator", directory: wiki.root, scope: "collaborator" });
  await expect(own["tool.execute.before"]({ tool: "read", sessionID: "private-collaborator" }, { args: { filePath: "Page.md" } }))
    .rejects.toThrow("not available");
  config.readOnly = true;
  await own["tool.execute.before"]({ tool: "read", sessionID: "wiki-session" }, { args: { filePath: "Page.md" } });
  await expect(own["tool.execute.before"]({ tool: "edit", sessionID: "wiki-session" }, { args: { filePath: "Page.md" } }))
    .rejects.toMatchObject({ code: "wiki_read_only" });
  config.readOnly = false;
  expect((await fetch(`${base}/wikis/file-policy`, { headers: { authorization: `Bearer ${config.token}` } })).status).toBe(403);
  const headers = { authorization: `Bearer ${config.token}`, "x-legalwork-host-token": config.hostToken, "content-type": "application/json" };
  for (const path of ["/session/project-session/shell", "/pty"]) {
    const response = await fetch(`${base}/workspace/${workspace.id}/opencode${path}`, { method: "POST", headers, body: "{}" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "sandbox_required" });
  }
});
