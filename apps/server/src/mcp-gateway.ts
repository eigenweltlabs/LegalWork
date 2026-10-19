import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema, CallToolResultSchema, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
  ToolListChangedNotificationSchema, ResourceListChangedNotificationSchema, PromptListChangedNotificationSchema,
  isInitializeRequest,
  isJSONRPCRequest, isJSONRPCNotification, isJSONRPCResultResponse, isJSONRPCErrorResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "./errors.js";
import type { McpConnectorManager } from "./mcp-manager.js";

type PendingResponse = { done: Promise<void>; finish: () => void };
type GatewaySession = { connectionId: string; workspaceId: string; server: Server; transport: WebStandardStreamableHTTPServerTransport; lastUsed: number; responses: Map<string | number, PendingResponse> };

/** Sessions belong to an engine's workspace. Upstream credentials and refresh
 * coordination belong exclusively to the connector manager. */
export class LocalMcpGateway {
  private sessions = new Map<string, GatewaySession>();
  private notifiedClients = new WeakSet<object>();
  private unregister: () => void;
  constructor(private manager: McpConnectorManager) {
    const stopRetire = manager.onRetire(async id => {
      await Promise.allSettled(Array.from(this.sessions, async ([sessionId, session]) => {
        if (session.connectionId !== id) return;
        this.sessions.delete(sessionId);
        await Promise.allSettled(Array.from(session.responses.values(), response => response.done));
        await session.server.close();
      }));
    });
    const stopConnections = manager.onConnected((id, client) => this.observe(id, client));
    this.unregister = () => { stopRetire(); stopConnections(); };
  }

  private observe(connectionId: string, client: Client) {
    if (this.notifiedClients.has(client)) return;
    this.notifiedClients.add(client);
    const broadcast = (method: "notifications/tools/list_changed" | "notifications/resources/list_changed" | "notifications/prompts/list_changed") => {
      for (const session of this.sessions.values()) if (session.connectionId === connectionId) void session.server.notification({ method }).catch(() => {});
    };
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => broadcast("notifications/tools/list_changed"));
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => broadcast("notifications/resources/list_changed"));
    client.setNotificationHandler(PromptListChangedNotificationSchema, () => broadcast("notifications/prompts/list_changed"));
  }

  async handle(request: Request, workspaceId: string, connectionId: string): Promise<Response> {
    if (!this.manager.authorize(request, workspaceId, connectionId)) return Response.json({ error: "unauthorized" }, { status: 401 });
    // Revalidate registry membership, enabled state and organization policy on
    // every request, including requests carrying an established MCP session.
    const record = await this.manager.gatewayConnection(workspaceId, connectionId);
    if (record.config.enabled === false) return Response.json({ error: "connection_disabled" }, { status: 503 });
    const id = request.headers.get("mcp-session-id");
    if (id) {
      const session = this.sessions.get(id);
      if (!session || session.connectionId !== connectionId || session.workspaceId !== workspaceId) return Response.json({ error: "session_not_found" }, { status: 404 });
      session.lastUsed = Date.now();
      const body: unknown = request.method === "POST" ? await request.clone().json().catch(() => null) : undefined;
      if (isJSONRPCNotification(body) && body.method === "notifications/cancelled") {
        const requestId = body.params?.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") session.responses.get(requestId)?.finish();
      }
      if (isJSONRPCRequest(body)) {
        const id = body.id;
        let resolve: () => void = () => {};
        const done = new Promise<void>(finish => { resolve = finish; });
        const finish = () => { session.responses.delete(id); request.signal.removeEventListener("abort", finish); resolve(); };
        session.responses.set(id, { done, finish });
        request.signal.addEventListener("abort", finish, { once: true });
      }
      try {
        const response = await session.transport.handleRequest(request, { parsedBody: body });
        if (response.status >= 400 && isJSONRPCRequest(body)) session.responses.get(body.id)?.finish();
        return response;
      } catch (error) {
        if (isJSONRPCRequest(body)) session.responses.get(body.id)?.finish();
        throw error;
      }
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const body: unknown = await request.clone().json().catch(() => null);
    if (!isInitializeRequest(body)) return Response.json({ error: "initialize_required" }, { status: 400 });
    for (const [sessionId, session] of this.sessions) {
      if (Date.now() - session.lastUsed < 30 * 60_000 || session.responses.size) continue;
      this.sessions.delete(sessionId);
      await session.server.close();
    }
    if (this.sessions.size >= 256) throw new ApiError(429, "mcp_session_limit", "Too many active connector sessions.");
    const client = await this.manager.client(record);
    const upstream = client.getServerCapabilities();
    const server = new Server({ name: "LegalWork MCP Gateway", version: "1.0.0" }, {
      capabilities: {
        ...(upstream?.tools ? { tools: upstream.tools } : {}),
        ...(upstream?.resources ? { resources: { listChanged: upstream.resources.listChanged } } : {}),
        ...(upstream?.prompts ? { prompts: upstream.prompts } : {}),
      },
      ...(client.getInstructions() ? { instructions: client.getInstructions() } : {}),
    });
    // The SDK correlates concurrent requests and propagates cancellation. Tool
    // calls are forwarded exactly once; a connection failure is never replayed.
    if (upstream?.tools) {
      server.setRequestHandler(ListToolsRequestSchema, async (message, extra) => (await this.manager.client(record)).listTools(message.params, { signal: extra.signal }));
      server.setRequestHandler(CallToolRequestSchema, async (message, extra) => (await this.manager.client(record)).callTool(message.params, CallToolResultSchema, {
        signal: extra.signal, timeout: record.config.timeout ?? 60_000,
        onprogress: progress => {
          const progressToken = message.params._meta?.progressToken;
          if (progressToken !== undefined) void extra.sendNotification({ method: "notifications/progress", params: { ...progress, progressToken } }).catch(() => {});
        },
      }));
    }
    if (upstream?.resources) {
      server.setRequestHandler(ListResourcesRequestSchema, async (message, extra) => (await this.manager.client(record)).listResources(message.params, { signal: extra.signal }));
      server.setRequestHandler(ListResourceTemplatesRequestSchema, async (message, extra) => (await this.manager.client(record)).listResourceTemplates(message.params, { signal: extra.signal }));
      server.setRequestHandler(ReadResourceRequestSchema, async (message, extra) => (await this.manager.client(record)).readResource(message.params, { signal: extra.signal }));
    }
    if (upstream?.prompts) {
      server.setRequestHandler(ListPromptsRequestSchema, async (message, extra) => (await this.manager.client(record)).listPrompts(message.params, { signal: extra.signal }));
      server.setRequestHandler(GetPromptRequestSchema, async (message, extra) => (await this.manager.client(record)).getPrompt(message.params, { signal: extra.signal }));
    }
    this.observe(connectionId, client);
    const responses = new Map<string | number, PendingResponse>();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: false,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${this.manager.config.port}`, `localhost:${this.manager.config.port}`],
      onsessioninitialized: sessionId => { this.sessions.set(sessionId, { connectionId, workspaceId, server, transport, lastUsed: Date.now(), responses }); },
      onsessionclosed: sessionId => { this.sessions.delete(sessionId); void server.close(); },
    });
    // Drain actual protocol responses, rather than the HTTP Response object,
    // which is returned before an SSE tool operation finishes.
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      try { await send(message, options); }
      finally {
        if ((isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) && message.id !== undefined) {
          responses.get(message.id)?.finish();
        }
      }
    };
    await server.connect(transport);
    try { return await transport.handleRequest(request, { parsedBody: body }); }
    catch (error) { await server.close(); throw error; }
  }

  async close() {
    this.unregister();
    await Promise.allSettled(Array.from(this.sessions.values(), session => session.server.close()));
    this.sessions.clear();
  }
}
