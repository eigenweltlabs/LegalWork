import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { startServer } from "./server.js";
import { TokenService } from "./tokens.js";
import { WikiStore } from "./wiki/store.js";
import { registerLocalProject } from "./routes/workspaces.js";
import { runtimeDbPath } from "./runtime-db.js";
import { ScheduledTaskStore } from "./scheduled-tasks/store.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./wiki/agent-access.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [], roots: string[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(readOnly = false) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-api-"));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "wiki-collaborator", hostToken: "wiki-host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const tokens = new TokenService(config), viewer = await tokens.create("viewer"), owner = await tokens.create("owner");
  const server = await startServer(config);
  stops.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const request = (path: string, scope: "host" | "owner" | "collaborator" | "viewer" | "anonymous" = "host", method = "GET", body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (scope === "host") { headers["x-legalwork-host-token"] = config.hostToken; headers.authorization = `Bearer ${config.token}`; }
    else if (scope !== "anonymous") headers.authorization = `Bearer ${scope === "owner" ? owner.token : scope === "viewer" ? viewer.token : config.token}`;
    return fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return { request, root, config, base };
}
const wikiSchema = z.object({ wiki: z.object({ id: z.string(), root: z.string(), workspaceId: z.string(), writable: z.boolean() }) });
const documentSchema = z.object({ path: z.string(), content: z.string(), revision: z.string(), updatedAt: z.number() });

describe("Wiki HTTP API", () => {
  test("hides personal wiki schedules and inbox entries while retaining ordinary project results", async () => {
    const { request, config, root } = await fixture();
    const { wiki } = wikiSchema.parse(await (await request("/wikis", "owner", "POST", { name: "Private schedules" })).json());
    const project = (await registerLocalProject(config, { folderPath: join(root, "Project"), name: "Ordinary project", preset: "starter" })).workspace;
    const input = { title: "Review", prompt: "Review this folder", sessionId: null,
      schedule: { kind: "once", startAt: new Date(Date.now() + 86400000).toISOString(), timeZone: "Europe/Berlin" } };
    const scheduled = z.object({ task: z.object({ id: z.string(), revision: z.number() }) });
    const privateTask = scheduled.parse(await (await request(`/workspace/${wiki.workspaceId}/scheduled-tasks`, "owner", "POST", input)).json()).task;
    const projectTask = scheduled.parse(await (await request(`/workspace/${project.id}/scheduled-tasks`, "collaborator", "POST", input)).json()).task;
    const db = new Database(join(root, "inbox-fixture.sqlite"));
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_updated INTEGER, time_archived INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);");
    db.query("INSERT INTO session VALUES (?, ?, ?, NULL)").run("private-chat", wiki.root, Date.now());
    db.query("INSERT INTO session VALUES (?, ?, ?, NULL)").run("project-chat", project.path, Date.now());
    const previousDb = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = join(root, "inbox-fixture.sqlite");
    const tasks = z.object({ tasks: z.array(z.object({ id: z.string(), workspaceId: z.string() })) });
    const projects = z.object({ projects: z.array(z.object({ id: z.string() })) });
    const inbox = z.object({ sessions: z.array(z.object({ sessionId: z.string(), workspaceId: z.string() })) });
    try {
      expect(tasks.parse(await (await request("/scheduled-tasks", "owner")).json()).tasks.map(item => item.id)).toContain(privateTask.id);
      expect(projects.parse(await (await request("/scheduled-tasks/projects", "owner")).json()).projects.map(item => item.id)).toContain(wiki.workspaceId);
      expect(inbox.parse(await (await request("/session-inbox", "owner")).json()).sessions.map(item => item.sessionId)).toContain("private-chat");
      const actors: Array<"collaborator" | "viewer"> = ["collaborator", "viewer"];
      for (const actor of actors) {
        expect(tasks.parse(await (await request("/scheduled-tasks", actor)).json()).tasks.map(item => item.id)).toEqual([projectTask.id]);
        expect(projects.parse(await (await request("/scheduled-tasks/projects", actor)).json()).projects.map(item => item.id)).toEqual([project.id]);
        expect(inbox.parse(await (await request("/session-inbox", actor)).json()).sessions.map(item => item.sessionId)).toEqual(["project-chat"]);
        expect((await request(`/workspace/${wiki.workspaceId}/scheduled-tasks/${privateTask.id}`, actor)).status).toBe(404);
      }
      expect((await request(`/workspace/${wiki.workspaceId}/scheduled-tasks`, "collaborator", "POST", input)).status).toBe(404);
      expect((await request(`/workspace/${wiki.workspaceId}/scheduled-tasks/${privateTask.id}`, "collaborator", "PATCH", { revision: privateTask.revision, status: "paused" })).status).toBe(404);
      expect((await request(`/workspace/${wiki.workspaceId}/scheduled-tasks/${privateTask.id}`, "collaborator", "DELETE", { revision: privateTask.revision })).status).toBe(404);
    } finally {
      if (previousDb === undefined) delete process.env.OPENCODE_DB; else process.env.OPENCODE_DB = previousDb;
      db.close();
    }
  });

  test("keeps wiki sharing separate from project sync and guards programmatic project registration", async () => {
    const { request, config, root } = await fixture();
    const { wiki } = wikiSchema.parse(await (await request("/wikis", "owner", "POST", { name: "Independent wiki" })).json());
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await request(`/workspace/${wiki.workspaceId}/project/sync`, "owner", method, method === "PUT" ? {} : undefined);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "wiki_project_sync" });
    }
    for (const folderPath of [wiki.root, join(wiki.root, "Nested project")]) {
      await expect(registerLocalProject(config, { folderPath, name: "Cannot expose the wiki", preset: "starter" })).rejects.toMatchObject({ code: "wiki_workspace_overlap" });
    }
    expect(config.workspaces.find(item => item.id === wiki.workspaceId)?.preset).toBe("wiki");
    const project = (await registerLocalProject(config, { folderPath: join(root, "Project"), name: "Separate project", preset: "starter" })).workspace;
    expect((await request(`/workspace/${project.id}/project/sync`, "collaborator")).status).toBe(200);
    expect((await request(`/workspace/${wiki.workspaceId}/project`, "owner")).status).toBe(200);
  });

  test("a scheduled run replaces a prior owner origin with collaborator scope before prompting", async () => {
    const { request, config, root, base } = await fixture();
    const { wiki } = wikiSchema.parse(await (await request("/wikis", "owner", "POST", { name: "Private scheduled knowledge" })).json());
    expect((await request(`/wikis/${wiki.id}`, "owner", "PATCH", { allowInProjects: true })).status).toBe(200);
    const project = (await registerLocalProject(config, { folderPath: join(root, "Project"), name: "Scheduled project", preset: "starter" })).workspace;
    const token = await ensureWikiAgentToken(config), sessionId = "existing-owner-chat";
    await grantWikiAgentSession(config, { sessionId, directory: project.path, scope: "owner" });
    const headers = { "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": sessionId, "x-legalwork-wiki-agent-directory": encodeURIComponent(project.path) };
    expect((await fetch(`${base}/wikis/${wiki.id}/page?path=Instructions.md`, { headers })).status).toBe(200);
    let restartedBase = "", privateReadStatus: number | undefined;
    let ready = () => {};
    const serverReady = new Promise<void>(resolve => { ready = resolve; });
    const engine = Bun.serve({ port: 0, fetch: async req => {
      const path = new URL(req.url).pathname;
      if (path === "/agent") return Response.json([{ name: "legalwork-scheduled-project", permission: [{ permission: "*", pattern: "*", action: "deny" }] }]);
      if (path === "/session/status") return Response.json({});
      if (path === `/session/${sessionId}`) return Response.json({ id: sessionId, directory: project.path, time: {} });
      if (path === `/session/${sessionId}/prompt_async`) {
        await serverReady;
        privateReadStatus = (await fetch(`${restartedBase}/wikis/${wiki.id}/page?path=Instructions.md`, { headers })).status;
        return new Response(null, { status: 204 });
      }
      return Response.json({});
    } });
    try {
      project.baseUrl = `http://127.0.0.1:${engine.port}`;
      const stopInitial = stops.pop();
      if (!stopInitial) throw new Error("Expected the initial fixture server");
      await stopInitial();
      const store = await ScheduledTaskStore.open(runtimeDbPath(config));
      const due = Date.now() - 60000;
      const task = store.create(project.id, { title: "Scheduled review", prompt: "Read available knowledge", sessionId,
        schedule: { kind: "once", startAt: new Date(due).toISOString(), timeZone: "Europe/Berlin" } }, due - 60000);
      const server = await startServer(config);
      stops.push(() => server.stop());
      restartedBase = `http://127.0.0.1:${server.port}`;
      ready();
      for (let attempt = 0; attempt < 200 && store.runs(task.id)[0]?.status !== "sent"; attempt++) await Bun.sleep(10);
      expect(store.runs(task.id)[0]?.status).toBe("sent");
      expect(privateReadStatus).toBe(404);
    } finally { ready(); engine.stop(true); }
  });

  test("enforces authentication, owner-only registration and personal wiki access through both API surfaces", async () => {
    const { request, config, base } = await fixture();
    expect((await request("/wikis", "anonymous")).status).toBe(401);
    expect((await request("/wikis", "collaborator", "POST", { name: "Denied" })).status).toBe(403);
    const created = await request("/wikis", "owner", "POST", { name: "Private wiki" });
    expect(created.status).toBe(201);
    const { wiki } = wikiSchema.parse(await created.json());
    expect(wiki.writable).toBe(true);
    expect((await request(`/wikis/${wiki.id}`, "host")).status).toBe(200);
    expect((await fetch(`${base}/wikis/${wiki.id}`, { headers: { "x-legalwork-host-token": config.hostToken } })).status).toBe(200);
    expect((await fetch(`${base}/wikis/${wiki.id}`, { headers: { authorization: `Bearer ${config.token}`, "x-legalwork-host-token": "invalid-host-token" } })).status).toBe(404);
    expect((await request(`/wikis/${wiki.id}`, "collaborator")).status).toBe(404);
    expect((await request(`/wikis/${wiki.id}/page?path=Instructions.md`, "viewer")).status).toBe(404);
    expect(await (await request("/wikis", "viewer")).json()).toEqual({ items: [] });
    expect((await request(`/workspace/${wiki.workspaceId}/files/raw?path=Instructions.md`, "collaborator")).status).toBe(404);
    expect((await request(`/workspace/${wiki.workspaceId}/files/raw?path=Instructions.md`, "owner")).status).toBe(200);
    expect((await request("/workspaces/local", "host", "POST", { folderPath: wiki.root, name: "Cannot expose wiki as a project" })).status).toBe(409);
    expect((await request("/workspaces/local", "host", "POST", { folderPath: join(wiki.root, "Nested project"), name: "Nested" })).status).toBe(409);
    expect((await request(`/wikis/${wiki.id}`, "owner", "PATCH", { name: "Renamed" })).status).toBe(200);
    expect((await request(`/wikis/${wiki.id}`, "host", "DELETE")).status).toBe(200);
    expect(await readFile(join(wiki.root, "Instructions.md"), "utf8")).toContain("Working in this wiki");
  });

  test("round-trips Markdown and binary assets, rejects stale saves, and restores deleted pages", async () => {
    const { request } = await fixture();
    const { wiki } = wikiSchema.parse(await (await request("/wikis", "host", "POST", { name: "Editable" })).json());
    const base = `/wikis/${wiki.id}`, path = "Processes/Financing.md";
    const created = await request(`${base}/page`, "host", "PUT", { path, content: "# Financing\n\nEvidence [source](../Attachments/source.pdf).\n", baseRevision: null });
    expect(created.status).toBe(200);
    const original = documentSchema.parse(await created.json());
    expect((await request(`${base}/page`, "host", "PUT", { path, content: "Overwritten", baseRevision: null })).status).toBe(409);
    const saved = await request(`${base}/page`, "host", "PUT", { path, content: "# Updated financing\n", baseRevision: original.revision });
    expect(saved.status).toBe(200);
    const updated = documentSchema.parse(await saved.json());
    expect((await request(`${base}/page`, "host", "DELETE", { path, baseRevision: original.revision })).status).toBe(409);
    expect((await request(`${base}/page`, "host", "DELETE", { path, baseRevision: updated.revision })).status).toBe(200);
    const history = z.object({ items: z.array(z.object({ id: z.string(), path: z.string(), action: z.string() })) }).parse(await (await request(`${base}/history?path=${encodeURIComponent(path)}`)).json());
    expect(history.items[0].action).toBe("delete");
    const first = history.items[history.items.length - 1];
    const restored = await request(`${base}/restore`, "host", "POST", { path, revisionId: first.id, baseRevision: null });
    expect(restored.status).toBe(200);
    expect(documentSchema.parse(await restored.json()).content).toBe(original.content);
    const bytes = Buffer.from([0, 128, 255, 80, 75]), assetPath = "Attachments/source.pdf";
    expect((await request(`${base}/asset`, "host", "POST", { path: assetPath, dataBase64: bytes.toString("base64"), baseRevision: null })).status).toBe(200);
    const asset = await request(`${base}/asset?path=${encodeURIComponent(assetPath)}`);
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(bytes);
    expect((await request(`${base}/asset`, "host", "POST", { path: "../escape.pdf", dataBase64: "AQ==" })).status).toBe(400);
    expect((await request(`${base}/asset`, "host", "POST", { path: "Attachments/bad.pdf", dataBase64: "!!!" })).status).toBe(400);
    const search = z.object({ items: z.array(z.object({ path: z.string() })) }).parse(await (await request(`${base}/search?q=Financing`)).json());
    expect(search.items.some((item) => item.path === path)).toBe(true);
  });

  test("legacy bindings remain local and cannot expose wiki contents through project storage", async () => {
    const { request, config } = await fixture();
    const store = new WikiStore(config);
    const wiki = await store.create({ name: "Legacy", attach: true, sync: { workspaceId: "origin-project", connectionId: "old-connection", path: "Shared knowledge" } });
    await store.write(wiki.id, "Shared.md", "# Retained local knowledge", "");
    await store.close();
    const base = `/wikis/${wiki.id}`;
    expect((await request(base, "viewer")).ok).toBe(false);
    expect((await request(`${base}/page`, "collaborator", "PUT", { path: "Denied.md", content: "# Denied", baseRevision: null })).ok).toBe(false);
    expect((await request(`${base}/page?path=Shared.md`, "owner")).status).toBe(200);
    expect(await (await request("/wikis", "viewer")).json()).toEqual({ items: [] });
    expect((await request("/wikis", "owner", "POST", { name: "No project bindings", sync: { workspaceId: "project", connectionId: "storage", path: "Knowledge" } })).status).toBe(400);
    expect((await request(base, "owner", "PATCH", { sync: null })).status).toBe(400);
  });

  test("team sharing has global endpoints and requires a firm account, without selecting a project", async () => {
    const { request, config } = await fixture();
    expect(config.workspaces).toHaveLength(0);
    expect((await request("/wikis/team", "viewer")).status).toBe(403);
    expect((await request("/wikis/team", "owner")).ok).toBe(false);
    expect((await request("/wikis", "owner", "POST", { name: "Firm Wiki", sharing: { access: "org", memberIds: [] } })).ok).toBe(false);
    expect(await (await request("/wikis", "owner")).json()).toEqual({ items: [] });
    expect((await request("/wikis/join", "collaborator", "POST", { wikiId: "cbb04c84-15f4-4a2b-a9f7-a5bd00d4a919" })).status).toBe(403);
  });

  test("server read-only mode blocks registration even for the owner", async () => {
    const { request } = await fixture(true);
    expect((await request("/wikis", "host", "POST", { name: "Read only" })).status).toBe(403);
  });
});
