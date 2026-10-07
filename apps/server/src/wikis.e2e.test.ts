import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { StorageInput } from "@legalwork/types/file-storage";
import { startServer } from "./server.js";
import { TokenService } from "./tokens.js";
import { StorageStore } from "./file-storage/store.js";
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

  test("shared wiki readers, collaborator edits and revoked storage access follow the server policy", async () => {
    const { request, config } = await fixture();
    const storage = new StorageStore(config);
    const input: StorageInput = { name: "Wiki sync", config: { kind: "webdav", endpoint: "http://127.0.0.1:1", username: "" }, enabled: true, readOnly: false, secrets: {} };
    const connection = await storage.save("origin-project", input);
    const { wiki } = wikiSchema.parse(await (await request("/wikis", "owner", "POST", { name: "Shared", attach: true, sync: { workspaceId: "origin-project", connectionId: connection.id, path: "Shared knowledge" } })).json());
    const base = `/wikis/${wiki.id}`;
    expect((await request(base, "viewer")).status).toBe(200);
    expect((await request(`${base}/page`, "viewer", "PUT", { path: "Denied.md", content: "# Denied", baseRevision: null })).status).toBe(403);
    expect((await request(`${base}/page`, "collaborator", "PUT", { path: "Shared.md", content: "# Shared", baseRevision: null })).status).toBe(200);
    await storage.save("origin-project", { ...input, readOnly: true }, connection.id);
    expect((await request(`${base}/page`, "collaborator", "PUT", { path: "Readonly.md", content: "# Denied", baseRevision: null })).status).toBe(403);
    expect((await request(`${base}/page?path=Shared.md`, "viewer")).status).toBe(200);
    await storage.save("origin-project", { ...input, enabled: false }, connection.id);
    expect((await request(`${base}/page?path=Shared.md`, "viewer")).status).toBe(403);
    expect((await request(`${base}/page?path=Shared.md`, "owner")).status).toBe(200);
    expect(await (await request("/wikis", "viewer")).json()).toEqual({ items: [] });
  });

  test("server read-only mode blocks registration even for the owner", async () => {
    const { request } = await fixture(true);
    expect((await request("/wikis", "host", "POST", { name: "Read only" })).status).toBe(403);
  });
});
