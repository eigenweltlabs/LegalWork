import { z } from "zod";
import type { WikiRegistration, WikiSnapshot, WikiSyncStatus, WikiVault } from "@legalwork/types/wiki";
import { ApiError } from "../errors.js";
import type { ApprovalRequest, ServerConfig, TokenScope } from "../types.js";
import { WikiStore, wikiAssetContentType, WIKI_MAX_ASSET_BYTES, WIKI_MAX_PAGE_BYTES, wikiSyncSchema } from "../wiki/store.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type Options = {
  routes: Route[];
  config: ServerConfig;
  store?: WikiStore;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  requireApproval: (ctx: RequestContext, input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">) => Promise<void>;
  ensureWikiReadable?: (ctx: RequestContext, wiki: WikiRegistration) => Promise<void>;
  ensureWikiWritable?: (ctx: RequestContext, wiki: WikiRegistration) => Promise<void>;
  onChanged?: (id: string) => void;
  onWorkspacesChanged?: () => void;
  getSyncStatus?: (id: string) => WikiSyncStatus | Promise<WikiSyncStatus>;
  syncWiki?: (id: string) => Promise<WikiSyncStatus>;
};
const createSchema = z.object({
  name: z.string().trim().min(1).max(200), root: z.string().trim().min(1).max(4096).optional(),
  template: z.enum(["firm", "blank"]).optional(), sync: wikiSyncSchema.nullable().optional(), attach: z.boolean().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(), allowInProjects: z.boolean().optional(), projectWorkspaceIds: z.array(z.string().min(1).max(200)).max(1000).nullable().optional(), sync: wikiSyncSchema.nullable().optional(),
});
const writeSchema = z.object({ path: z.string().min(1), content: z.string(), baseRevision: z.string().max(100).nullable().optional() });
const deleteSchema = z.object({ path: z.string().min(1), baseRevision: z.string().min(1).max(100) });
const restoreSchema = z.object({ path: z.string().min(1), revisionId: z.string().uuid(), baseRevision: z.string().max(100).nullable().optional() });
const assetSchema = z.object({ path: z.string().min(1), dataBase64: z.string(), baseRevision: z.string().max(100).nullable().optional() });
const owner = (ctx: RequestContext) => ctx.actor?.type === "host" || ctx.actor?.scope === "owner";
const editor = (ctx: RequestContext) => owner(ctx) || ctx.actor?.scope === "collaborator";

export function registerWikiRoutes(options: Options): WikiStore {
  const { routes, config, jsonResponse, readJsonBodyLimited, ensureWritable, requireClientScope, requireApproval } = options;
  const store = options.store ?? new WikiStore(config);
  const visible = (ctx: RequestContext, wiki: WikiRegistration) => owner(ctx) || wiki.sync !== null;
  const selected = async (ctx: RequestContext, writing = false): Promise<WikiRegistration> => {
    const wiki = await store.get(ctx.params.wikiId);
    if (!visible(ctx, wiki)) throw new ApiError(404, "wiki_not_found", "This wiki is not available to this client.");
    await options.ensureWikiReadable?.(ctx, wiki);
    if (writing) {
      requireClientScope(ctx, "collaborator");
      ensureWritable(config);
      await options.ensureWikiWritable?.(ctx, wiki);
    }
    return wiki;
  };
  const vault = async (ctx: RequestContext, snapshot: WikiSnapshot): Promise<WikiVault> => {
    let writable = !config.readOnly && editor(ctx);
    if (writable && options.ensureWikiWritable) {
      try { await options.ensureWikiWritable(ctx, snapshot.wiki); } catch { writable = false; }
    }
    return { ...snapshot.wiki, writable, syncStatus: options.getSyncStatus ? await options.getSyncStatus(snapshot.wiki.id) : snapshot.wiki.syncStatus };
  };
  const change = (id: string) => { options.onChanged?.(id); };
  const authorize = async (ctx: RequestContext, wiki: WikiRegistration, action: string, paths: string[]) => {
    await requireApproval(ctx, { workspaceId: wiki.workspaceId, action, summary: `${action.replace("wiki.", "")} in ${wiki.name}`, paths });
  };
  const queryPath = (ctx: RequestContext, bodyPath?: string) => {
    const query = ctx.url.searchParams.get("path");
    if (query && bodyPath && query !== bodyPath) throw new ApiError(400, "invalid_wiki_path", "The query and body must refer to the same file.");
    const path = query || bodyPath;
    if (!path) throw new ApiError(400, "invalid_wiki_path", "Provide a wiki file path.");
    return path;
  };

  addRoute(routes, "GET", "/wikis", "client", async (ctx) => {
    const items: WikiVault[] = [];
    for (const wiki of await store.list()) if (visible(ctx, wiki)) {
      try { await options.ensureWikiReadable?.(ctx, wiki); } catch { continue; }
      try { items.push(await vault(ctx, await store.snapshot(wiki.id))); }
      catch (error) {
        // A disconnected local folder must not hide the other wikis or prevent reconnecting it.
        const status = options.getSyncStatus ? await options.getSyncStatus(wiki.id) : { state: "error", lastSyncedAt: null, error: error instanceof Error ? error.message : "Wiki folder unavailable.", conflicts: [] };
        items.push({ ...wiki, writable: false, pageCount: 0, totalBytes: 0, syncStatus: { ...status, state: "error", error: error instanceof Error ? error.message : "Wiki folder unavailable." } });
      }
    }
    return jsonResponse({ items });
  });
  addRoute(routes, "POST", "/wikis", "client", async (ctx) => {
    requireClientScope(ctx, "owner");
    ensureWritable(config);
    const parsed = createSchema.safeParse(await readJsonBodyLimited(ctx.request, 16 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_wiki_configuration", "Provide a name, optional folder, and valid sync settings.");
    const wiki = await store.create(parsed.data);
    options.onWorkspacesChanged?.();
    change(wiki.id);
    return jsonResponse({ wiki: await vault(ctx, await store.snapshot(wiki.id)) }, 201);
  });
  addRoute(routes, "GET", "/wikis/:wikiId", "client", async (ctx) => {
    await selected(ctx);
    const snapshot = await store.snapshot(ctx.params.wikiId);
    return jsonResponse({ ...snapshot, wiki: await vault(ctx, snapshot) });
  });
  addRoute(routes, "PATCH", "/wikis/:wikiId", "client", async (ctx) => {
    requireClientScope(ctx, "owner");
    ensureWritable(config);
    await selected(ctx);
    const parsed = updateSchema.safeParse(await readJsonBodyLimited(ctx.request, 16 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_wiki_configuration", "Check the wiki name and sync settings.");
    const wiki = await store.update(ctx.params.wikiId, parsed.data);
    options.onWorkspacesChanged?.();
    change(wiki.id);
    return jsonResponse({ wiki: await vault(ctx, await store.snapshot(wiki.id)) });
  });
  addRoute(routes, "DELETE", "/wikis/:wikiId", "client", async (ctx) => {
    requireClientScope(ctx, "owner");
    ensureWritable(config);
    await selected(ctx);
    await store.forget(ctx.params.wikiId);
    options.onWorkspacesChanged?.();
    change(ctx.params.wikiId);
    return jsonResponse({ ok: true });
  });
  addRoute(routes, "GET", "/wikis/:wikiId/page", "client", async (ctx) => {
    await selected(ctx);
    return jsonResponse(await store.read(ctx.params.wikiId, queryPath(ctx)));
  });
  addRoute(routes, "PUT", "/wikis/:wikiId/page", "client", async (ctx) => {
    const wiki = await selected(ctx, true);
    const parsed = writeSchema.safeParse(await readJsonBodyLimited(ctx.request, WIKI_MAX_PAGE_BYTES + 128 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_wiki_page", "Provide a path, Markdown content and optional base revision.");
    const path = queryPath(ctx, parsed.data.path);
    await authorize(ctx, wiki, "wiki.write", [path]);
    const document = await store.write(wiki.id, path, parsed.data.content, parsed.data.baseRevision ?? "");
    change(wiki.id);
    return jsonResponse(document);
  });
  addRoute(routes, "DELETE", "/wikis/:wikiId/page", "client", async (ctx) => {
    const wiki = await selected(ctx, true);
    const parsed = deleteSchema.safeParse(await readJsonBodyLimited(ctx.request, 8 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_wiki_page", "Provide the path and the current revision before deleting a file.");
    const path = queryPath(ctx, parsed.data.path);
    await authorize(ctx, wiki, "wiki.delete", [path]);
    await store.remove(wiki.id, path, parsed.data.baseRevision);
    change(wiki.id);
    return jsonResponse({ ok: true });
  });
  addRoute(routes, "GET", "/wikis/:wikiId/history", "client", async (ctx) => {
    await selected(ctx);
    return jsonResponse({ items: await store.history(ctx.params.wikiId, ctx.url.searchParams.get("path") ?? "") });
  });
  addRoute(routes, "POST", "/wikis/:wikiId/restore", "client", async (ctx) => {
    const wiki = await selected(ctx, true);
    const parsed = restoreSchema.safeParse(await readJsonBodyLimited(ctx.request, 8 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_wiki_revision", "Provide a page path and revision to restore.");
    await authorize(ctx, wiki, "wiki.restore", [parsed.data.path]);
    const document = await store.restore(wiki.id, parsed.data.path, parsed.data.revisionId, parsed.data.baseRevision ?? "");
    change(wiki.id);
    return jsonResponse(document);
  });
  addRoute(routes, "GET", "/wikis/:wikiId/asset", "client", async (ctx) => {
    await selected(ctx);
    const path = queryPath(ctx), bytes = await store.readAsset(ctx.params.wikiId, path);
    return new Response(new Uint8Array(bytes), { headers: {
      "content-type": wikiAssetContentType(path), "content-length": String(bytes.length), "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-store",
      ...(/\.(?:html?|svg)$/i.test(path) ? { "content-disposition": "attachment" } : {}),
    } });
  });
  addRoute(routes, "POST", "/wikis/:wikiId/asset", "client", async (ctx) => {
    const wiki = await selected(ctx, true);
    const parsed = assetSchema.safeParse(await readJsonBodyLimited(ctx.request, Math.ceil(WIKI_MAX_ASSET_BYTES * 4 / 3) + 32 * 1024));
    if (!parsed.success || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.data.dataBase64)) throw new ApiError(400, "invalid_wiki_asset", "Provide a file path and valid base64 data.");
    await authorize(ctx, wiki, "wiki.attach", [parsed.data.path]);
    const result = await store.writeAsset(wiki.id, parsed.data.path, Buffer.from(parsed.data.dataBase64, "base64"), parsed.data.baseRevision ?? "");
    change(wiki.id);
    return jsonResponse(result);
  });
  addRoute(routes, "GET", "/wikis/:wikiId/search", "client", async (ctx) => {
    await selected(ctx);
    return jsonResponse({ items: await store.search(ctx.params.wikiId, (ctx.url.searchParams.get("q") ?? "").slice(0, 2000), ctx.url.searchParams.get("type") ?? undefined) });
  });
  addRoute(routes, "POST", "/wikis/:wikiId/sync", "client", async (ctx) => {
    const wiki = await selected(ctx);
    if (!options.syncWiki) throw new ApiError(503, "wiki_sync_unavailable", "Wiki sync is unavailable on this server.");
    return jsonResponse(await options.syncWiki(wiki.id));
  });
  return store;
}
