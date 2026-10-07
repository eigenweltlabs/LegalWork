import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startServer } from "../server.js";
import { TokenService } from "../tokens.js";
import { serve } from "../serve-node.js";
import { WikiStore } from "../wiki/store.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
import type { ServerConfig } from "../types.js";
import { LegalWorkWikiTools } from "./legalwork-wiki-tools.js";

const previousUrl = process.env.LEGALWORK_SERVER_URL;
const previousToken = process.env.LEGALWORK_SERVER_TOKEN;
const previousAgentToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
const stops: Array<() => Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL;
  else process.env.LEGALWORK_SERVER_URL = previousUrl;
  if (previousToken === undefined) delete process.env.LEGALWORK_SERVER_TOKEN;
  else process.env.LEGALWORK_SERVER_TOKEN = previousToken;
  if (previousAgentToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN;
  else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previousAgentToken;
});

test("an agent captures an authorized source into real Markdown through the server API", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-agent-http-"));
  roots.push(root);
  const project = join(root, "matter");
  await mkdir(project);
  const sourcePath = join(project, "Closing note.md");
  await writeFile(sourcePath, "# Closing note\n\nThe practice team used a closing checklist. An incomplete signature delayed closing.\n");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "wiki-agent-client", hostToken: "wiki-agent-host",
    configPath: join(root, "configuration", "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "matter", name: "Matter", path: project, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  const owner = await new TokenService(config).create("owner", { label: "Wiki integration fixture" });
  const agentToken = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config, { sessionId: "session-capture", directory: project, scope: "owner" });
  const server = await startServer(config);
  stops.push(async () => { await server.stop(); });
  const url = `http://127.0.0.1:${server.port}`;
  process.env.LEGALWORK_SERVER_URL = url;
  process.env.LEGALWORK_SERVER_TOKEN = config.token;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = agentToken;
  const headers = { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" };
  const created = await fetch(`${url}/wikis`, { method: "POST", headers,
    body: JSON.stringify({ name: "Practice knowledge", root: join(root, "knowledge"), template: "firm" }) });
  expect(created.status).toBe(201);
  const { wiki } = z.object({ wiki: z.object({ id: z.string(), root: z.string() }) }).parse(await created.json());
  const { tool } = await LegalWorkWikiTools({ directory: project, sessionID: "session-capture" });
  const skills = JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: "Skills/Capture.md" }));
  expect(skills.content).toContain("Capture learning after a matter");
  expect(skills.guidance.some((entry: { path: string }) => entry.path === "Structure.md")).toBe(true);

  // A source read is required before capture. No model or remote document system
  // is simulated here: this fixture tests the actual tool -> HTTP -> file/index path.
  const source = await readFile(sourcePath, "utf8");
  expect(source).toContain("incomplete signature");
  const content = "---\ntype: process\nstatus: draft\n---\n# Closing checklist\n\nObserved in one closing: validate all signatures before closing.\n\n## Sources\nLocal authorized matter file: Closing note.md, Closing note section.\n\nSee [[Processes/Knowledge capture.md]].\n";
  const saved = JSON.parse(await tool.wiki_write.execute({ wiki_id: wiki.id, path: "Processes/Closing checklist.md", content, base_revision: null }));
  expect(saved.ok).toBe(true);
  expect(await readFile(join(wiki.root, saved.path), "utf8")).toBe(content);
  const found = JSON.parse(await tool.wiki_search.execute({ wiki_id: wiki.id, query: "signatures", type: "process" }));
  expect(found.pages.some((page: { path: string }) => page.path === saved.path)).toBe(true);
  const opened = JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: saved.path }));
  const replacement = JSON.parse(await tool.wiki_write.execute({ wiki_id: wiki.id, path: saved.path,
    content: content + "\nReview each signature block.\n", base_revision: opened.revision }));
  expect(replacement.ok).toBe(true);
  const stale = JSON.parse(await tool.wiki_write.execute({ wiki_id: wiki.id, path: saved.path,
    content: "# Stale overwrite\n", base_revision: opened.revision }));
  expect(stale.code).toBe("wiki_revision_conflict");
  expect(await readFile(join(wiki.root, saved.path), "utf8")).toContain("Review each signature block");

  const revoked = await fetch(`${url}/wikis/${wiki.id}`, { method: "PATCH", headers, body: JSON.stringify({ allowInProjects: false }) });
  expect(revoked.status).toBe(200);
  expect(JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: saved.path })).code).toBe("wiki_access_denied");
  await grantWikiAgentSession(config, { sessionId: "session-wiki", directory: wiki.root, scope: "owner" });
  const ownSession = await LegalWorkWikiTools({ directory: wiki.root, sessionID: "session-wiki" });
  expect(JSON.parse(await ownSession.tool.wiki_read.execute({ wiki_id: wiki.id, path: saved.path })).revision).toBe(replacement.revision);
  await grantWikiAgentSession(config, { sessionId: "session-wiki", directory: wiki.root, scope: "collaborator" });
  const collaborator = JSON.parse(await ownSession.tool.wiki_read.execute({ wiki_id: wiki.id, path: saved.path }));
  expect(collaborator.ok).toBe(false);
  const unknown = await LegalWorkWikiTools({ directory: project, sessionID: "session-unknown" });
  expect(JSON.parse(await unknown.tool.wiki_list.execute({})).code).toBe("wiki_agent_session_unknown");
});

test("authenticated proxy session origin grants local wiki access and a collaborator prompt downgrades it", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-proxy-origin-"));
  roots.push(root);
  const project = join(root, "Prüfung 東京");
  await mkdir(project);
  const engine = await serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/session") return Response.json({ id: "ses_http_origin", directory: project, title: "Matter" });
    if (request.method === "POST" && path === "/session/ses_http_origin/message") return Response.json({ id: "msg_fixture", sessionID: "ses_http_origin" });
    if (request.method === "POST" && path === "/session/ses_http_origin/prompt_async") return new Response(null, { status: 204 });
    if (request.method === "POST" && path === "/session/ses_http_origin/fork") return Response.json({ id: "ses_http_fork", directory: project, title: "Fork" });
    return Response.json({ ok: true });
  } });
  stops.push(async () => { await engine.stop(); });
  const engineUrl = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "origin-client", hostToken: "origin-host", opencodeBaseUrl: engineUrl,
    configPath: join(root, "configuration", "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "origin-matter", name: "Matter", path: project, preset: "starter", workspaceType: "local", baseUrl: engineUrl }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  const store = new WikiStore(config);
  const wiki = await store.create({ name: "Personal knowledge", root: join(root, "wiki"), template: "blank" });
  await store.close();
  const runtimeToken = await ensureWikiAgentToken(config);
  const server = await startServer(config);
  stops.unshift(async () => { await server.stop(); });
  const url = `http://127.0.0.1:${server.port}`;
  const proxyPath = `${url}/workspace/origin-matter/opencode/session`;
  const query = new URLSearchParams({ directory: project });
  const created = await fetch(`${proxyPath}?${query}`, { method: "POST",
    headers: { "x-legalwork-host-token": config.hostToken, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Matter" }) });
  expect(created.status).toBe(200);
  expect(z.object({ id: z.string() }).parse(await created.json()).id).toBe("ses_http_origin");
  process.env.LEGALWORK_SERVER_URL = url;
  process.env.LEGALWORK_SERVER_TOKEN = config.token;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = runtimeToken;
  const { tool } = await LegalWorkWikiTools({ directory: project, sessionID: "ses_http_origin" });
  const listed = JSON.parse(await tool.wiki_list.execute({}));
  expect(listed.wikis.some((entry: { id: string }) => entry.id === wiki.id)).toBe(true);
  expect(JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: "Structure.md" })).content).toContain("Wiki structure");

  const prompted = await fetch(`${proxyPath}/ses_http_origin/prompt_async?${query}`, { method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ parts: [] }) });
  expect(prompted.status).toBe(204);
  const denied = JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: "Structure.md" }));
  expect(denied.ok).toBe(false);
  expect(denied.code).toBe("wiki_access_denied");

  const hostCommand = await fetch(`${proxyPath}/ses_http_origin/command?${query}`, { method: "POST",
    headers: { "x-legalwork-host-token": config.hostToken, "Content-Type": "application/json" },
    body: JSON.stringify({ command: "capture", arguments: "" }) });
  expect(hostCommand.status).toBe(200);
  expect(JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: "Structure.md" })).content).toContain("Wiki structure");
  const forked = await fetch(`${proxyPath}/ses_http_origin/fork?${query}`, { method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ scope: "owner" }) });
  expect(forked.status).toBe(200);
  const forkId = z.object({ id: z.string() }).parse(await forked.json()).id;
  const fork = await LegalWorkWikiTools({ directory: project, sessionID: forkId });
  expect(JSON.parse(await fork.tool.wiki_read.execute({ wiki_id: wiki.id, path: "Structure.md" })).code).toBe("wiki_access_denied");
  expect(JSON.parse(await tool.wiki_read.execute({ wiki_id: wiki.id, path: "Structure.md" })).code).toBe("wiki_access_denied");

  const narrow = await fetch(`${url}/tokens`, { headers: {
    "x-legalwork-wiki-agent-token": runtimeToken, "x-legalwork-wiki-agent-session": "ses_http_origin",
    "x-legalwork-wiki-agent-directory": encodeURIComponent(project),
  } });
  expect(narrow.status).toBe(403);
});
