import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { z } from "zod";
import { ViewRecordSchema, type ViewInput } from "@legalwork/types/views";
import { startServer } from "../server.js";
import { serve } from "../serve-node.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";
import { listApprovals, respondApproval, waitForApprovals, type TestApproval } from "./approval.test-helpers.js";

const roots: string[] = [], stops: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const documentSchema = z.object({ path: z.string(), content: z.string(), revision: z.string() });
const input: ViewInput = { version: 1, title: "Review", mode: "report", catalog: "legalwork-1", program: 'root = Text("Review")', queries: {} };

async function fixture(timeoutMs = 3_000) {
  const root = await mkdtemp(join(tmpdir(), "wiki-write-approval-"));
  roots.push(root);
  const project = join(root, "Matter");
  await mkdir(project);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "approval-client", hostToken: "approval-host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs }, corsOrigins: ["*"],
    workspaces: [{ id: "matter", name: "Matter", path: project, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  const agentToken = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config, { sessionId: "matter-chat", directory: project, scope: "owner" });
  const server = await startServer(config);
  stops.push(() => server.stop());
  const url = `http://127.0.0.1:${server.port}`;
  const host = (path: string, method = "GET", body?: unknown) => fetch(`${url}${path}`, { method,
    headers: { "x-legalwork-host-token": config.hostToken, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const created = await host("/wikis", "POST", { name: "Knowledge", root: join(root, "Knowledge"), template: "blank" });
  expect(created.status).toBe(201);
  const { wiki } = z.object({ wiki: z.object({ id: z.string(), root: z.string(), workspaceId: z.string() }) }).parse(await created.json());
  const base = `/wikis/${wiki.id}`;
  const content = "---\ntype: client\nstatus: draft\n---\n# Client\n\nOriginal text.\n";
  const page = documentSchema.parse(await (await host(`${base}/page`, "PUT", { path: "Client.md", content, baseRevision: null })).json());
  const view = ViewRecordSchema.parse(await (await host(`${base}/ui-views`, "POST", input)).json());
  const headers = (sessionID = "matter-chat", directory = project) => ({ "content-type": "application/json",
    "x-legalwork-wiki-agent-token": agentToken, "x-legalwork-wiki-agent-session": sessionID,
    "x-legalwork-wiki-agent-directory": encodeURIComponent(directory),
  });
  const agent = (path: string, method = "GET", body?: unknown, signal?: AbortSignal) => fetch(`${url}${base}${path}`, {
    method, headers: headers(), signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const pending = async (action: string) => {
    const [approval] = await waitForApprovals(url, config.hostToken);
    expect(approval).toMatchObject({ action, workspaceId: "matter", sessionID: "matter-chat",
      actor: { type: "remote", clientId: "wiki-agent:matter-chat", scope: "owner" } });
    expect(approval.workspaceId).not.toBe(wiki.workspaceId);
    expect(approval.summary).toContain("Matter");
    return approval;
  };
  const reply = (approval: TestApproval, value: "allow" | "deny") => respondApproval(url, config.hostToken, approval, value);
  const unchanged = async () => {
    expect(await readFile(join(wiki.root, page.path), "utf8")).toBe(content);
    const current = ViewRecordSchema.parse(await (await host(`${base}/ui-views/${view.id}`)).json());
    expect(current.revision).toBe(view.revision);
    expect(current.title).toBe(view.title);
    expect(z.object({ items: z.array(z.unknown()) }).parse(await (await host(`${base}/ui-views`)).json()).items).toHaveLength(1);
  };
  return { root, project, config, wiki, url, base, host, headers, agent, page, view, pending, reply, unchanged };
}

async function descendantFixture() {
  const f = await fixture();
  const directory = await realpath(f.project);
  const sessions = new Map([
    ["matter-chat", { id: "matter-chat", directory, parentID: undefined }],
    ["child-chat", { id: "child-chat", directory, parentID: "matter-chat" }],
  ]);
  const engineRequests: string[] = [];
  const engine = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/session/")) return Response.json({ error: "Not found" }, { status: 404 });
    expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from("wiki-engine:test-secret").toString("base64")}`);
    expect(request.headers.get("x-opencode-directory")).toBe(directory);
    const id = decodeURIComponent(path.slice("/session/".length));
    engineRequests.push(id);
    const record = sessions.get(id);
    return record ? Response.json(record) : Response.json({ error: "Unknown session" }, { status: 404 });
  } });
  stops.push(() => engine.stop());
  const workspace = f.config.workspaces.find(item => item.id === "matter");
  if (!workspace) throw new Error("Matter workspace missing");
  workspace.baseUrl = `http://127.0.0.1:${engine.port}`;
  workspace.opencodeUsername = "wiki-engine";
  workspace.opencodePassword = "test-secret";
  const child = (path: string, method = "GET", body?: unknown) => fetch(`${f.url}${path}`, {
    method, headers: f.headers("child-chat"), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const pendingChild = async () => {
    const [approval] = await waitForApprovals(f.url, f.config.hostToken);
    expect(approval).toMatchObject({ action: "wiki.write", workspaceId: "matter", sessionID: "child-chat",
      actor: { type: "remote", clientId: "wiki-agent:child-chat", scope: "owner" } });
    return approval;
  };
  return { ...f, sessions, engineRequests, child, pendingChild };
}

test("engine-created child agents read wikis, with writes approved in the actual child chat", async () => {
  const f = await descendantFixture();
  for (const path of ["/wikis", `${f.base}/page?path=Client.md`, `${f.base}/fields`])
    expect((await f.child(path)).status).toBe(200);
  expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
  expect(f.engineRequests).toContain("child-chat");
  expect(f.engineRequests).toContain("matter-chat");
  const proposal = { path: f.page.path, content: "# Child proposal\n", baseRevision: f.page.revision };
  const result = f.child(`${f.base}/page`, "PUT", proposal);
  const approval = await f.pendingChild();
  expect(JSON.parse(approval.description ?? "null")).toEqual(proposal);
  const wrongChat = await f.host(`/approvals/${approval.id}`, "POST", { reply: "allow", workspaceId: "matter", sessionID: "matter-chat" });
  expect(wrongChat.status).toBe(409);
  await f.unchanged();
  expect((await f.reply(approval, "allow")).status).toBe(200);
  expect((await result).status).toBe(200);
  expect(await readFile(join(f.wiki.root, f.page.path), "utf8")).toBe(proposal.content);
});

test("ancestor scope and project access are checked again after a child approval", async () => {
  const f = await descendantFixture();
  const proposal = { path: f.page.path, content: "# Revoked child proposal\n", baseRevision: f.page.revision };
  const result = f.child(`${f.base}/page`, "PUT", proposal);
  const approval = await f.pendingChild();
  await grantWikiAgentSession(f.config, { sessionId: "matter-chat", directory: f.project, scope: "collaborator" });
  expect((await f.reply(approval, "allow")).status).toBe(200);
  const downgraded = await result;
  expect(downgraded.status).toBe(404);
  expect(await downgraded.json()).toMatchObject({ code: "wiki_not_found" });
  await f.unchanged();
  await grantWikiAgentSession(f.config, { sessionId: "matter-chat", directory: f.project, scope: "owner" });
  const second = f.child(`${f.base}/page`, "PUT", proposal);
  const secondApproval = await f.pendingChild();
  expect((await f.host(f.base, "PATCH", { allowInProjects: false })).status).toBe(200);
  expect((await f.reply(secondApproval, "allow")).status).toBe(200);
  expect((await second).status).toBe(403);
  await f.unchanged();
});

test("a revoked ancestor and changed engine lineage cannot retain child wiki access", async () => {
  const f = await descendantFixture();
  expect((await f.child(`${f.base}/page?path=Client.md`)).status).toBe(200);
  const original = f.sessions.get("child-chat");
  if (!original) throw new Error("Child session missing");
  f.sessions.set("child-chat", { ...original, parentID: "unregistered-parent" });
  expect((await f.child(`${f.base}/page?path=Client.md`)).status).toBe(403);
  f.sessions.set("child-chat", { ...original, directory: f.root });
  expect((await f.child("/wikis")).status).toBe(403);
  f.sessions.set("child-chat", original);
  await grantWikiAgentSession(f.config, { sessionId: "matter-chat", directory: join(f.root, "unavailable"), scope: "owner" });
  expect((await f.child(`${f.base}/page?path=Client.md`)).status).toBe(403);
  expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
  await f.unchanged();
});

test("project wiki reads, discovery and report reads do not require approval", async () => {
  const f = await fixture();
  for (const path of ["/page?path=Client.md", "/search?q=Client", "/fields", "/ui-views", `/ui-views/${f.view.id}`]) {
    expect((await f.agent(path)).status).toBe(200);
    expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
  }
  expect((await f.agent("/query", "POST", { fields: ["title", "status"] })).status).toBe(200);
  expect((await fetch(`${f.url}/wikis`, { headers: f.headers() })).status).toBe(200);
  expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
});

test("write, property update, view create, view update and delete each need a fresh project-chat approval in auto mode", async () => {
  const f = await fixture();
  const ids = new Set<string>();
  const allow = async (result: Promise<Response>, action: string, proposal: unknown) => {
    const approval = await f.pending(action);
    expect(ids.has(approval.id)).toBe(false);
    ids.add(approval.id);
    expect(JSON.parse(approval.description ?? "null")).toEqual(proposal);
    expect((await f.reply(approval, "allow")).status).toBe(200);
    const response = await result;
    expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
    expect((await f.reply(approval, "allow")).status).toBe(404);
    return response;
  };
  const write = { path: f.page.path, content: f.page.content + "\nApproved text.\n", baseRevision: f.page.revision };
  const writing = f.agent("/page", "PUT", write);
  const written = documentSchema.parse(await (await allow(writing, "wiki.write", write)).json());
  expect(await readFile(join(f.wiki.root, f.page.path), "utf8")).toBe(write.content);
  const patch = { path: written.path, baseRevision: written.revision, patch: { set: { status: "reviewed" } } };
  const patched = documentSchema.parse(await (await allow(f.agent("/properties", "PATCH", patch), "wiki.properties.update", patch)).json());
  expect(patched.content).toContain('status: "reviewed"');
  const reportInput = { ...input, title: "Approved report", datasets: {} };
  const created = await allow(f.agent("/ui-views", "POST", reportInput), "wiki.view.create", reportInput);
  expect(created.status).toBe(201);
  const report = ViewRecordSchema.parse(await created.json());
  const update = { baseRevision: report.revision, input: { ...reportInput, title: "Approved update" } };
  const updated = ViewRecordSchema.parse(await (await allow(f.agent(`/ui-views/${report.id}`, "PUT", update), "wiki.view.update", update)).json());
  expect(updated.title).toBe("Approved update");
  const remove = { path: patched.path, baseRevision: patched.revision };
  expect((await allow(f.agent("/page", "DELETE", remove), "wiki.delete", remove)).status).toBe(200);
  expect(await Bun.file(join(f.wiki.root, f.page.path)).exists()).toBe(false);
  expect(ids.size).toBe(5);
});

test("denying any wiki mutation leaves pages and saved views unchanged", async () => {
  const f = await fixture();
  const operations = [
    { path: "/page", method: "PUT", action: "wiki.write", body: { path: f.page.path, content: "# Rejected\n", baseRevision: f.page.revision } },
    { path: "/page", method: "DELETE", action: "wiki.delete", body: { path: f.page.path, baseRevision: f.page.revision } },
    { path: "/properties", method: "PATCH", action: "wiki.properties.update", body: { path: f.page.path, baseRevision: f.page.revision, patch: { set: { status: "rejected" } } } },
    { path: "/ui-views", method: "POST", action: "wiki.view.create", body: { ...input, title: "Rejected view" } },
    { path: `/ui-views/${f.view.id}`, method: "PUT", action: "wiki.view.update", body: { baseRevision: f.view.revision, input: { ...input, title: "Rejected update" } } },
  ];
  for (const operation of operations) {
    const result = f.agent(operation.path, operation.method, operation.body);
    const approval = await f.pending(operation.action);
    await f.unchanged();
    expect((await f.reply(approval, "deny")).status).toBe(200);
    const denied = await result;
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "write_denied", details: { reason: "denied" } });
    await f.unchanged();
    expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
  }
});

test("another chat, another workspace and the agent itself cannot approve the pending change", async () => {
  const f = await fixture();
  const result = f.agent("/page", "DELETE", { path: f.page.path, baseRevision: f.page.revision });
  const approval = await f.pending("wiki.delete");
  for (const identity of [{ sessionID: "other-chat", workspaceId: "matter" }, { sessionID: "matter-chat", workspaceId: "other-workspace" }, {}]) {
    const rejected = await f.host(`/approvals/${approval.id}`, "POST", { reply: "allow", ...identity });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "approval_session_mismatch" });
  }
  const self = await fetch(`${f.url}/approvals/${approval.id}`, { method: "POST", headers: f.headers(),
    body: JSON.stringify({ reply: "allow", workspaceId: "matter", sessionID: "matter-chat" }) });
  expect(self.status).toBe(403);
  expect((await listApprovals(f.url, f.config.hostToken)).map(item => item.id)).toEqual([approval.id]);
  await f.unchanged();
  await f.reply(approval, "deny");
  expect((await result).status).toBe(403);
});

test("timed-out project wiki approval cannot later apply its change", async () => {
  const f = await fixture(200);
  const result = f.agent("/page", "DELETE", { path: f.page.path, baseRevision: f.page.revision });
  const approval = await f.pending("wiki.delete");
  const timedOut = await result;
  expect(timedOut.status).toBe(403);
  expect(await timedOut.json()).toMatchObject({ code: "write_denied", details: { reason: "timeout" } });
  expect((await f.reply(approval, "allow")).status).toBe(404);
  await f.unchanged();
});

test("cancelling the agent HTTP request clears approval and preserves the file", async () => {
  const f = await fixture(10_000);
  const controller = new AbortController();
  const result = f.agent("/page", "DELETE", { path: f.page.path, baseRevision: f.page.revision }, controller.signal);
  const approval = await f.pending("wiki.delete");
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(await waitForApprovals(f.url, f.config.hostToken, 0, 500)).toEqual([]);
  expect((await f.reply(approval, "allow")).status).toBe(404);
  await f.unchanged();
});

test("disconnecting the agent socket clears its pending wiki approval", async () => {
  const f = await fixture(10_000);
  const request = httpRequest(`${f.url}${f.base}/page`, { method: "DELETE", headers: f.headers() });
  const result = new Promise<void>((resolve, reject) => { request.once("error", reject); request.once("close", resolve); });
  request.end(JSON.stringify({ path: f.page.path, baseRevision: f.page.revision }));
  const approval = await f.pending("wiki.delete");
  request.destroy();
  await result.catch(() => undefined);
  expect(await waitForApprovals(f.url, f.config.hostToken, 0, 500)).toEqual([]);
  expect((await f.reply(approval, "allow")).status).toBe(404);
  await f.unchanged();
});

test("a wiki's own session follows ordinary approval mode even when project access is disabled", async () => {
  const f = await fixture();
  expect((await f.host(f.base, "PATCH", { allowInProjects: false })).status).toBe(200);
  await grantWikiAgentSession(f.config, { sessionId: "own-wiki-chat", directory: f.wiki.root, scope: "owner" });
  const ownWrite = (revision: string, content: string) => fetch(`${f.url}${f.base}/page`, { method: "PUT",
    headers: f.headers("own-wiki-chat", f.wiki.root), body: JSON.stringify({ path: f.page.path, content, baseRevision: revision }) });
  const auto = await ownWrite(f.page.revision, "# Own wiki edit\n");
  expect(auto.status).toBe(200);
  const page = documentSchema.parse(await auto.json());
  expect(await listApprovals(f.url, f.config.hostToken)).toEqual([]);
  f.config.approval.mode = "manual";
  const manual = ownWrite(page.revision, "# Manual own wiki edit\n");
  const [approval] = await waitForApprovals(f.url, f.config.hostToken);
  expect(approval).toMatchObject({ action: "wiki.write", workspaceId: f.wiki.workspaceId });
  await f.reply(approval, "deny");
  expect((await manual).status).toBe(403);
  expect(await readFile(join(f.wiki.root, f.page.path), "utf8")).toBe(page.content);
});

test("project access revoked during review prevents an approved change", async () => {
  const f = await fixture();
  const result = f.agent("/page", "DELETE", { path: f.page.path, baseRevision: f.page.revision });
  const approval = await f.pending("wiki.delete");
  expect((await f.host(f.base, "PATCH", { allowInProjects: false })).status).toBe(200);
  expect((await f.reply(approval, "allow")).status).toBe(200);
  const denied = await result;
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "wiki_access_denied" });
  await f.unchanged();
});

test("agent scope revoked during review is reauthenticated before applying an approved change", async () => {
  const f = await fixture();
  const result = f.agent("/page", "DELETE", { path: f.page.path, baseRevision: f.page.revision });
  const approval = await f.pending("wiki.delete");
  await grantWikiAgentSession(f.config, { sessionId: "matter-chat", directory: f.project, scope: "collaborator" });
  expect((await f.reply(approval, "allow")).status).toBe(200);
  const denied = await result;
  expect(denied.status).toBe(404);
  expect(await denied.json()).toMatchObject({ code: "wiki_not_found" });
  await f.unchanged();
});
