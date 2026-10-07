import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-origin-"));
  roots.push(root);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "collaborator", hostToken: "host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "project", name: "Project", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false };
  const token = await ensureWikiAgentToken(config);
  const request = (path = "/wikis", input?: { token?: string; session?: string; directory?: string; method?: string }) =>
    new Request(`http://127.0.0.1${path}`, { method: input?.method ?? "GET", headers: {
      "x-legalwork-wiki-agent-token": input?.token ?? token,
      "x-legalwork-wiki-agent-session": input?.session ?? "session-1",
      "x-legalwork-wiki-agent-directory": encodeURIComponent(input?.directory ?? root),
    } });
  return { root, config, token, request };
}

test("runtime credential is stable per running server and never an owner/host credential", async () => {
  const { config, token, request } = await fixture();
  expect(await ensureWikiAgentToken(config)).toBe(token);
  expect(token).not.toBe(config.token);
  expect(token).not.toBe(config.hostToken);
  expect(await authenticateWikiAgentRequest(config, new Request("http://localhost/wikis"))).toBeNull();
  await expect(authenticateWikiAgentRequest(config, request())).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { token: config.hostToken }))).rejects.toMatchObject({ code: "wiki_agent_unauthorized" });
});

test("server-recorded origin controls actor scope and collaborator takeover downgrades immediately", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  const owner = await authenticateWikiAgentRequest(config, request());
  expect(owner?.actor.scope).toBe("owner");
  expect(owner?.actor.type).toBe("remote");
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "collaborator" });
  expect((await authenticateWikiAgentRequest(config, request()))?.actor.scope).toBe("collaborator");
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "viewer" });
  expect((await authenticateWikiAgentRequest(config, request()))?.actor.scope).toBe("viewer");
});

test("session directory claims require the canonical recorded directory", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  const alias = `${root}-alias`;
  roots.push(alias);
  await symlink(root, alias);
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { directory: alias })))?.directory).toBe(await realpath(root));
  const other = join(root, "other");
  await mkdir(other);
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { directory: other }))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  await expect(grantWikiAgentSession(config, { sessionId: "session-1", directory: other, scope: "owner" })).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
});

test("Unicode directories use encoded headers and unavailable remote directories revoke stale grants", async () => {
  const { config, root, request } = await fixture();
  const unicode = join(root, "Prüfung 東京");
  await mkdir(unicode);
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: unicode, scope: "owner" });
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { directory: unicode })))?.directory).toBe(await realpath(unicode));
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: join(root, "remote-unavailable"), scope: "collaborator" });
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { directory: unicode }))).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("runtime auth permits only the page tool endpoints and refuses broader management/proxy access", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  for (const [path, method] of [["/wikis", "GET"], ["/workspaces", "GET"], ["/wikis/wiki-id/search?q=note", "GET"],
    ["/wikis/wiki-id/page?path=Note.md", "GET"], ["/wikis/wiki-id/page", "PUT"], ["/wikis/wiki-id/page", "DELETE"]])
    expect((await authenticateWikiAgentRequest(config, request(path, { method })))?.actor.scope).toBe("owner");
  for (const [path, method] of [["/wikis", "POST"], ["/wikis/wiki-id", "PATCH"], ["/workspaces", "POST"],
    ["/workspace/project/opencode/session", "POST"], ["/tokens", "GET"], ["/wikis/wiki-id/restore", "POST"]])
    await expect(authenticateWikiAgentRequest(config, request(path, { method }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
});
