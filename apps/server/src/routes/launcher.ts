import { resolve } from "node:path";
import { z } from "zod";
import { AssistantContextItemSchema, AssistantWorkStatusSchema, LAUNCHER_SEARCH_KINDS, LauncherInvocationSchema, LauncherInvocationSourceSchema, LauncherSearchKindSchema, QuickActionInputSchema } from "@legalwork/types/launcher";
import { ApiError } from "../errors.js";
import { isMainAssistant } from "../main-assistant.js";
import { readAssistantAttention } from "../assistant-attention.js";
import { readDelegationResult } from "../assistant-delegation-result.js";
import { listAssistantWork } from "../assistant-work.js";
import { launcherCatalog, renderQuickActionPrompt } from "../launcher-actions.js";
import { filterRecordings, searchLauncher } from "../launcher-search.js";
import { searchFileContents, searchSessionContents } from "../content-search.js";
import { taskStore } from "../task-store.js";
import { connectedTaskOrgId } from "../tasks-api.js";
import { readEigenweltConnection } from "../eigenwelt-connection-store.js";
import type { WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext } from "./registry.js";
import type { registerMainAssistantRoutes } from "./main-assistant.js";

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, code, message, parsed.error.issues);
  return parsed.data;
}

export function registerLauncherRoutes(options: Parameters<typeof registerMainAssistantRoutes>[0]) {
  const { config, routes, jsonResponse, quickActions, stagedContext, fileIndex, delegations, sessionQueue, conversations, submissions } = options;
  const read = (ctx: RequestContext) => options.requireClientScope(ctx, "viewer");
  const write = (ctx: RequestContext) => { options.ensureWritable(config); options.requireClientScope(ctx, "collaborator"); };
  const projectName = (workspace: WorkspaceInfo) => (isMainAssistant(workspace) ? options.assistant.profile().name : null) ?? (workspace.displayName || workspace.name);
  const accessible = async () => {
    const candidates = config.workspaces.filter(workspace => workspace.workspaceType !== "remote" && !isMainAssistant(workspace));
    const results = await Promise.allSettled(candidates.map(workspace => options.resolveWorkspace(config, workspace.id)));
    const workspaces: WorkspaceInfo[] = [], unavailable: string[] = [];
    results.forEach((result, index) => { if (result.status === "fulfilled") workspaces.push(result.value); else unavailable.push(candidates[index].id); });
    return { workspaces, unavailable };
  };
  const recordings = () => {
    const list = config.recorder?.listRecordings ?? config.recorder?.library?.list;
    return list ? async (query: string) => filterRecordings((await list()).filter(meta => !meta.ephemeral).map(meta => ({ id: meta.id, title: meta.title, createdAt: meta.createdAt, durationMs: meta.durationMs, projectIds: meta.projectIds ?? [], status: meta.status })), query).slice(0, 200) : null;
  };
  addRoute(routes, "GET", "/launcher/search", "client", async ctx => {
    read(ctx);
    const input = parse(z.object({ q: z.string().trim().max(300).default(""), kinds: z.string().max(100).optional(), projectId: z.string().max(200).optional(), content: z.enum(["1", "0"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(80) }),
      Object.fromEntries(ctx.url.searchParams), "launcher_query", "Check the search query, categories and project scope.");
    const kinds = input.kinds ? input.kinds.split(",").map(kind => LauncherSearchKindSchema.parse(kind.trim())) : [...LAUNCHER_SEARCH_KINDS];
    const orgId = connectedTaskOrgId(await readEigenweltConnection(config));
    const store = await taskStore(config);
    const response = await searchLauncher({
      workspaces: accessible, projectName, fileIndex, recordings: recordings(),
      tasks: async (query, projectId) => store.searchTasks(query, orgId, projectId ?? "", Boolean(projectId)),
      sessionSearch: (workspace, query, signal) => searchSessionContents(config, workspace, query, signal),
      fileContentSearch: (workspace, query, signal) => searchFileContents(workspace, query, signal, options.preparation),
    }, { query: input.q, kinds, projectId: input.projectId, content: input.content === "1", limit: input.limit }, ctx.request.signal);
    return jsonResponse(response);
  });
  addRoute(routes, "GET", "/launcher/catalog", "client", async ctx => {
    read(ctx);
    const projectId = ctx.url.searchParams.get("projectId")?.trim() || undefined;
    const groups: { workspaceId: string | null; items: { name: string; description?: string; template?: string; agent?: string }[] }[] = [];
    const sources = [config.workspaces.find(isMainAssistant), projectId ? config.workspaces.find(workspace => workspace.id === projectId) : undefined].filter((workspace): workspace is WorkspaceInfo => Boolean(workspace));
    const unavailable: string[] = [];
    for (const source of sources) {
      try {
        const workspace = await options.resolveWorkspace(config, source.id);
        if (workspace.workspaceType === "remote") continue;
        const result = await options.client(workspace).command.list({}, { signal: AbortSignal.timeout(10000) });
        groups.push({ workspaceId: isMainAssistant(workspace) ? null : workspace.id, items: result.data ?? [] });
      } catch { unavailable.push(source.id); }
    }
    return jsonResponse({ entries: launcherCatalog({ commands: groups, quickActions: quickActions.list() }), unavailable });
  });
  addRoute(routes, "GET", "/launcher/actions", "client", async ctx => { read(ctx); return jsonResponse({ actions: quickActions.list() }); });
  addRoute(routes, "POST", "/launcher/actions", "client", async ctx => {
    write(ctx);
    const input = parse(QuickActionInputSchema, await options.readJsonBodyLimited(ctx.request, 32_000), "quick_action_input", "Provide a name, prompt, inputs and output for the quick action.");
    return jsonResponse({ action: quickActions.create(input) }, 201);
  });
  addRoute(routes, "PATCH", "/launcher/actions/:id", "client", async ctx => {
    write(ctx);
    const patch = parse(QuickActionInputSchema.partial(), await options.readJsonBodyLimited(ctx.request, 32_000), "quick_action_input", "Check the quick action fields.");
    return jsonResponse({ action: quickActions.update(ctx.params.id, patch) });
  });
  addRoute(routes, "DELETE", "/launcher/actions/:id", "client", async ctx => { write(ctx); quickActions.remove(ctx.params.id); return jsonResponse({ ok: true }); });
  addRoute(routes, "POST", "/launcher/actions/:id/used", "client", async ctx => { write(ctx); return jsonResponse({ action: quickActions.recordUse(ctx.params.id) }); });
  addRoute(routes, "POST", "/launcher/actions/:id/render", "client", async ctx => {
    read(ctx);
    const action = quickActions.get(ctx.params.id);
    if (!action) throw new ApiError(404, "quick_action_not_found", "This quick action no longer exists.");
    const inputs = parse(z.object({ selection: z.string().max(200_000).optional(), clipboard: z.string().max(200_000).optional(), files: z.array(z.string().max(4096)).max(50).optional(), arguments: z.string().max(8000).optional() }),
      await options.readJsonBodyLimited(ctx.request, 512 * 1024), "quick_action_render", "Provide the action inputs.");
    return jsonResponse({ prompt: renderQuickActionPrompt(action, inputs), action });
  });
  // Staged context: external entry points hand over an opaque reference, never the content itself.
  addRoute(routes, "POST", "/launcher/context", "client", async ctx => {
    write(ctx);
    const input = parse(z.object({ items: z.array(AssistantContextItemSchema).min(1).max(20), source: LauncherInvocationSourceSchema, ttlMs: z.number().int().min(1000).max(30 * 60_000).optional() }),
      await options.readJsonBodyLimited(ctx.request, 2 * 1024 * 1024), "launcher_context", "Provide at least one context item.");
    const staged = stagedContext.stage(input.items, input.source, input.ttlMs);
    return jsonResponse({ id: staged.id, expiresAt: staged.expiresAt, items: staged.items.length }, 201);
  });
  addRoute(routes, "POST", "/launcher/context/:id/consume", "client", async ctx => {
    write(ctx);
    const staged = stagedContext.consume(ctx.params.id);
    if (!staged) throw new ApiError(404, "launcher_context_expired", "This staged context has expired or was already used.");
    return jsonResponse(staged);
  });
  addRoute(routes, "POST", "/launcher/invocations", "client", async ctx => {
    write(ctx);
    const invocation = parse(LauncherInvocationSchema, await options.readJsonBodyLimited(ctx.request, 16_000), "launcher_invocation", "Provide a valid launcher invocation.");
    if (invocation.projectId && !config.workspaces.some(workspace => workspace.id === invocation.projectId)) throw new ApiError(404, "workspace_not_found", "The requested project is unknown.");
    const fresh = stagedContext.rememberInvocation(invocation.id);
    return jsonResponse({ invocation, duplicate: !fresh, context: invocation.contextId ? stagedContext.peek(invocation.contextId) : null });
  });
  // Work: every delegated job with its origin, exact destination and live status.
  const sourceWorkspace = async () => {
    const source = config.workspaces.find(isMainAssistant);
    if (!source) return null;
    await options.resolveWorkspace(config, source.id);
    return source;
  };
  addRoute(routes, "GET", "/assistant/work", "client", async ctx => {
    read(ctx);
    const filter = parse(z.object({ status: AssistantWorkStatusSchema.optional(), projectId: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }), Object.fromEntries(ctx.url.searchParams), "work_query", "Check the work filters.");
    const source = await sourceWorkspace();
    if (!source) return jsonResponse({ items: [] });
    const tracked = delegations.list(source.id).slice(0, filter.limit);
    const items = await listAssistantWork(tracked, {
      originConversationId: sessionId => conversations.bySession(source.id, sessionId)?.id ?? null,
      inspect: async delegation => {
        const workspace = await options.resolveWorkspace(config, delegation.workspaceId);
        const client = options.client(workspace);
        const session = await client.session.get({ sessionID: delegation.sessionId }, { throwOnError: true, signal: AbortSignal.timeout(10000) });
        const available = Boolean(session.data && !session.data.time.archived && resolve(session.data.directory) === resolve(workspace.path));
        const common = { title: session.data?.title ?? delegation.title, projectName: projectName(workspace), createdAt: session.data?.time.created ?? null, updatedAt: session.data?.time.updated ?? null, queuedMessages: sessionQueue.list({ workspaceId: delegation.workspaceId, sessionId: delegation.sessionId }).length };
        if (!available) return { ...common, available: false, busy: false, result: null, pendingAttention: 0 };
        const [statuses, result, attention] = await Promise.all([
          client.session.status({}, { throwOnError: true, signal: AbortSignal.timeout(10000) }),
          readDelegationResult(client, delegation.sessionId),
          readAssistantAttention(client, { workspaceId: delegation.workspaceId, sessionId: delegation.sessionId, projectName: common.projectName, sessionTitle: common.title }).catch(() => []),
        ]);
        const status = statuses.data?.[delegation.sessionId];
        return { ...common, available: true, busy: Boolean(status && status.type !== "idle"), result, pendingAttention: attention.filter(item => item.kind !== "widget").length };
      },
    }, { status: filter.status, projectId: filter.projectId });
    return jsonResponse({ items });
  });
  addRoute(routes, "POST", "/assistant/work/:workspaceId/:sessionId/:action", "client", async ctx => {
    write(ctx);
    const source = await sourceWorkspace();
    if (!source) throw new ApiError(404, "assistant_missing", "The Assistant is unavailable.");
    const delegation = delegations.list(source.id).find(item => item.workspaceId === ctx.params.workspaceId && item.sessionId === ctx.params.sessionId);
    if (!delegation) throw new ApiError(404, "attention_scope", "This chat was not delegated by your Assistant.");
    const action = parse(z.enum(["stop", "redirect", "reply"]), ctx.params.action, "work_action", "Stop, redirect or reply to one job.");
    const body = ctx.request.body ? await options.readJsonBodyLimited(ctx.request, 20_000) : {};
    const prompt = parse(z.string().trim().min(1).max(12000).optional(), body.prompt, "work_prompt", "Provide the instruction.");
    const requestId = parse(z.string().min(1).max(200).optional(), body.requestId, "work_request", "Provide a request ID.");
    const destination = { workspaceId: delegation.workspaceId, sessionId: delegation.sessionId };
    if (action === "stop") { const result = await sessionQueue.stop(destination); options.changed(); return jsonResponse({ ok: true, ...result }); }
    if (!prompt) throw new ApiError(400, "work_prompt", "Provide the user's instruction before replying or redirecting.");
    const receipt = sessionQueue.receipt(destination, prompt, requestId);
    if (receipt) return jsonResponse({ ok: true, status: receipt.state, message: receipt });
    if (action === "redirect") await sessionQueue.stop(destination);
    const message = await sessionQueue.submit(destination, prompt, requestId);
    options.changed();
    return jsonResponse({ ok: true, status: message.state, message });
  });
  // The execution target bound to a conversation's latest request: the server, not the prompt, is the boundary.
  addRoute(routes, "GET", "/assistant/conversations/:id/constraint", "client", async ctx => {
    read(ctx);
    const source = await sourceWorkspace();
    const conversation = source ? conversations.find(source.id, ctx.params.id) : null;
    if (!conversation) throw new ApiError(404, "conversation_not_found", "This conversation is no longer available.");
    return jsonResponse({ target: submissions.constraint(conversation.sessionId) });
  });
}
