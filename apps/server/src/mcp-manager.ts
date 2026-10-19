import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { auth, refreshAuthorization, selectResourceURL, UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ApiError } from "./errors.js";
import { FIRM_MCP_SCOPE, isMcpSecureStorageError, McpManagerStore, remoteMcpSchema, type ManagedMcpRecord } from "./mcp-manager-store.js";
import { firmHubConnectorBlocks, firmHubConnectorScope, onFirmHubChange } from "./firm-hub.js";
import { GLOBAL_MCP_ID, readGlobalMcpMap, readRuntimeOpencodeConfig, runtimeMcpMap, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { allowedMemberConnectors } from "./org-policy-items.js";
import { connectorConfigVariables } from "./connector-config.js";
import { tokensMatch } from "./utils.js";
import type { ServerConfig } from "./types.js";

type PendingAuthorization = { state: string; verifier?: string; authorizationUrl?: string; expiresAt: number; revision: string; redirectUri: string; discovery?: OAuthDiscoveryState };
type ConnectionRuntime = {
  revision: string; controller: AbortController; client?: Client; connecting?: Promise<Client>;
  discovery?: OAuthDiscoveryState; pending?: PendingAuthorization; failedAt?: number;
  refreshRetryAt?: number;
  status: { status: "connected" | "needs_auth" | "failed" | "disabled"; error?: string };
};
const managers = new WeakMap<ServerConfig, McpConnectorManager>();
const publicDescriptor = (record: ManagedMcpRecord): Record<string, unknown> => ({
  type: "remote", url: new URL(record.config.url).origin, enabled: record.config.enabled,
  ...(record.config.oauth === false ? { oauth: false } : { oauth: {} }), managedConnectionId: record.id,
});
const connectionKey = (scope: string, name: string) => JSON.stringify([scope, name]);
const missing = () => new ApiError(404, "managed_mcp_not_found", "This connector is no longer available.");
const signin = () => new ApiError(409, "mcp_reconnect_required", "Reconnect this connector in LegalWork to restore access.");

/** Reject credential-bearing cross-origin redirects and HTTPS downgrade. The
 * destination comes exclusively from an app-managed configuration or OAuth discovery. */
async function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url = new URL(input instanceof Request ? input.url : input);
  const options: RequestInit = { ...init, redirect: "manual" };
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid MCP provider URL.");
    const response = await fetch(url, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel();
    const next = new URL(location, url);
    const credentialBearing = new Headers(options.headers).has("authorization") || options.body != null;
    if ((url.protocol === "https:" && next.protocol !== "https:") || (next.origin !== url.origin && credentialBearing)) throw new Error("MCP provider redirected credentials to another origin.");
    url = next;
  }
  throw new Error("Too many MCP provider redirects.");
}

export class McpConnectorManager {
  readonly store: McpManagerStore;
  private opening?: Promise<void>;
  private closed = false;
  private lifetime = new AbortController();
  get signal() { return this.lifetime.signal; }
  private secret = randomBytes(32);
  private queues = new Map<string, Promise<unknown>>();
  private configurationMutations = new Map<string, Promise<unknown>>();
  private runtimes = new Map<string, ConnectionRuntime>();
  private retired = new Set<string>();
  private closeGateways = new Set<(id: string) => Promise<void>>();
  private connectedListeners = new Set<(id: string, client: Client) => void>();
  private stopFirmEvents: () => void;

  constructor(readonly config: ServerConfig) {
    this.store = new McpManagerStore(config);
    this.stopFirmEvents = onFirmHubChange(config, () => { void this.reconcileFirmConnections().catch(() => {}); });
  }
  private async ready() {
    if (this.closed) throw new Error("MCP connector manager is closed.");
    this.opening ??= this.store.open();
    try { await this.opening; } catch (error) { this.opening = undefined; throw error; }
  }
  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(key, result);
    try { return await result; } finally { if (this.queues.get(key) === result) this.queues.delete(key); }
  }
  /** Serialize the vault + registry pair, including global/workspace moves. */
  async mutateConfiguration<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.configurationMutations.get(name) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.configurationMutations.set(name, result);
    try { return await result; } finally { if (this.configurationMutations.get(name) === result) this.configurationMutations.delete(name); }
  }
  private runtime(record: ManagedMcpRecord): ConnectionRuntime {
    const previous = this.runtimes.get(record.id);
    if (previous?.revision === record.revision) return previous;
    previous?.controller.abort();
    void previous?.client?.close();
    const current: ConnectionRuntime = { revision: record.revision, controller: new AbortController(), status: { status: record.reconnectRequired ? "needs_auth" : record.config.enabled === false ? "disabled" : "failed" } };
    this.runtimes.set(record.id, current);
    return current;
  }
  private current(key: string, revision?: string) {
    const record = this.store.get(key);
    if (this.closed || !record || this.retired.has(record.revision) || (revision !== undefined && record.revision !== revision)) throw missing();
    return record;
  }
  private async retire(record: ManagedMcpRecord) {
    this.retired.add(record.revision);
    const runtime = this.runtimes.get(record.id);
    runtime?.controller.abort();
    this.runtimes.delete(record.id);
    // Let upstream request failures reach the gateway's HTTP responses before
    // closing its transports; the SDK otherwise discards pending JSON replies.
    await runtime?.client?.close().catch(() => {});
    await Promise.allSettled(Array.from(this.closeGateways, close => close(record.id)));
  }
  onRetire(close: (id: string) => Promise<void>) { this.closeGateways.add(close); return () => this.closeGateways.delete(close); }
  onConnected(listener: (id: string, client: Client) => void) { this.connectedListeners.add(listener); return () => this.connectedListeners.delete(listener); }

  async configure(scope: string, name: string, input: Record<string, unknown>): Promise<ManagedMcpRecord> {
    await this.ready();
    const key = connectionKey(scope, name);
    const unchanged = this.store.get(key);
    if (unchanged && input.managedConnectionId === unchanged.id && (unchanged.config.enabled !== false) === (input.enabled !== false)) return unchanged;
    return this.exclusive(key, async () => {
      const previous = this.store.get(key);
      if (typeof input.managedConnectionId === "string") {
        if (!previous || previous.id !== input.managedConnectionId) throw missing();
        const enabled = input.enabled !== false;
        if ((previous.config.enabled !== false) === enabled) return previous;
        await this.retire(previous);
        const record = { ...previous, config: { ...previous.config, enabled }, revision: randomUUID() };
        await this.store.put(record);
        return record;
      }
      const config = remoteMcpSchema.parse(input);
      const configurationHash = createHash("sha256").update(JSON.stringify({
        url: config.url, oauth: config.oauth ?? {},
        headers: Object.fromEntries(Object.entries(config.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      })).digest("hex");
      const sameIdentity = previous && previous.configurationHash === configurationHash;
      if (sameIdentity && JSON.stringify(previous.config) === JSON.stringify(config)) {
        if (scope.startsWith(FIRM_MCP_SCOPE)) this.store.hydrate(key, config);
        return { ...previous, config };
      }
      if (previous) await this.retire(previous);
      const record: ManagedMcpRecord = {
        ...(sameIdentity ? previous : {}), id: sameIdentity ? previous.id : randomUUID(), key, revision: randomUUID(), config, configurationHash,
      };
      await this.store.put(record);
      return record;
    });
  }

  async original(entry: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof entry.managedConnectionId !== "string") return entry;
    try { await this.ready(); } catch (error) { if (isMcpSecureStorageError(error)) return entry; throw error; }
    const record = this.store.all().find(item => item.id === entry.managedConnectionId);
    if (!record) throw missing();
    return { ...record.config, enabled: entry.enabled !== false };
  }

  private async reconcileFirmConnections() {
    if (!this.opening || this.closed) return;
    const scope = await firmHubConnectorScope(this.config);
    const entries = await firmHubConnectorBlocks(this.config);
    for (const record of this.store.all()) {
      const [owner, name] = z.tuple([z.string(), z.string()]).parse(JSON.parse(record.key));
      if (!owner.startsWith(FIRM_MCP_SCOPE)) continue;
      if (owner === `${FIRM_MCP_SCOPE}${scope}` && entries[name]) {
        const entry = z.record(z.string(), z.unknown()).parse(entries[name]);
        await this.configure(owner, name, entry);
      } else {
        await this.retire(record);
        await this.exclusive(record.key, () => this.store.remove(record.key));
      }
    }
  }

  async find(workspaceId: string, name: string) {
    const [global, own] = await Promise.all([readGlobalMcpMap(this.config), readRuntimeOpencodeConfig(this.config, workspaceId)]);
    const workspace = runtimeMcpMap(own);
    const firm = z.record(z.string(), z.unknown()).safeParse((await firmHubConnectorBlocks(this.config))[name]);
    const firmScope = firm.success ? await firmHubConnectorScope(this.config) : null;
    const scope = firmScope ? `${FIRM_MCP_SCOPE}${firmScope}` : Object.hasOwn(workspace, name) ? workspaceId : GLOBAL_MCP_ID;
    const entry = firm.success && firmScope ? firm.data : workspace[name] ?? global[name];
    if (!entry || entry.type !== "remote" || connectorConfigVariables(entry).length) return undefined;
    if (!firmScope && !(await allowedMemberConnectors(this.config, { [name]: entry }))[name]) return undefined;
    const record = await this.configure(scope, name, entry);
    return { record, scope, entry };
  }

  token(workspaceId: string, id: string) { return createHmac("sha256", this.secret).update(JSON.stringify([workspaceId, id])).digest("base64url"); }
  authorize(request: Request, workspaceId: string, id: string) {
    return tokensMatch(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "", this.token(workspaceId, id));
  }
  async engineEntries(workspaceId: string, entries: Record<string, Record<string, unknown>>) {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.type !== "remote") { result[name] = entry; continue; }
      if (connectorConfigVariables(entry).length) {
        result[name] = { type: "remote", url: `http://127.0.0.1:${this.config.port}/mcp/gateway/unconfigured`, enabled: false, oauth: false };
        continue;
      }
      let found;
      try { found = await this.find(workspaceId, name); }
      catch (error) {
        if (!isMcpSecureStorageError(error)) throw error;
        // A locked vault must not prevent the rest of LegalWork starting, or
        // fall back to handing provider credentials to an engine.
        result[name] = { type: "remote", url: `http://127.0.0.1:${this.config.port}/mcp/gateway/locked`, enabled: false, oauth: false };
        continue;
      }
      if (!found) continue;
      const { record } = found;
      result[name] = {
        type: "remote", enabled: record.config.enabled !== false, oauth: false,
        url: `http://127.0.0.1:${this.config.port}/mcp/gateway/${encodeURIComponent(workspaceId)}/${record.id}`,
        headers: { Authorization: `Bearer ${this.token(workspaceId, record.id)}` },
        ...(record.config.timeout ? { timeout: record.config.timeout } : {}),
      };
    }
    return result;
  }

  async engineConfiguration(directory: string) {
    const requested = await realpath(directory).catch(() => resolve(directory));
    const localWorkspaces = this.config.workspaces.filter(workspace => workspace.workspaceType !== "remote");
    const candidates = await Promise.all(localWorkspaces.map(async workspace => ({ workspace, path: await realpath(workspace.path).catch(() => resolve(workspace.path)) })));
    const selected = candidates.sort((a, b) => b.path.length - a.path.length).find(candidate => {
      const path = relative(candidate.path, requested);
      return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
    });
    const global = await readGlobalMcpMap(this.config);
    const firm = z.record(z.string(), z.record(z.string(), z.unknown())).parse(await firmHubConnectorBlocks(this.config));
    const rows = await Promise.all(localWorkspaces.map(async workspace => ({ workspace, mcp: runtimeMcpMap(await readRuntimeOpencodeConfig(this.config, workspace.id)) })));
    const managedNames = [...new Set([...Object.keys(global), ...Object.keys(firm), ...rows.flatMap(row => Object.keys(row.mcp))])];
    if (!selected) return { mcp: {}, managedNames };
    const own = rows.find(row => row.workspace.id === selected.workspace.id)?.mcp ?? {};
    const entries = { ...await allowedMemberConnectors(this.config, { ...global, ...own }), ...firm };
    return { mcp: await this.engineEntries(selected.workspace.id, entries), managedNames };
  }

  /** Move provider configuration into the vault before an engine can see it. */
  async reconcile() {
    for (const scope of [GLOBAL_MCP_ID, ...this.config.workspaces.filter(item => item.workspaceType !== "remote").map(item => item.id)]) {
      const row = await readRuntimeOpencodeConfig(this.config, scope);
      const map = runtimeMcpMap(row);
      let changed = false;
      for (const [name, entry] of Object.entries(map)) {
        if (entry.type !== "remote" || connectorConfigVariables(entry).length) continue;
        const record = await this.configure(scope, name, entry);
        if (!entry.managedConnectionId) { map[name] = publicDescriptor(record); changed = true; }
      }
      if (changed) await writeRuntimeOpencodeConfig(this.config, scope, current => ({ ...current, mcp: map }));
    }
  }

  async save(scope: string, name: string, entry: Record<string, unknown>) { return publicDescriptor(await this.configure(scope, name, entry)); }
  async remove(scope: string, name: string) {
    if (!this.opening) return;
    await this.ready();
    const key = connectionKey(scope, name), before = this.store.get(key);
    if (!before) return;
    await this.retire(before);
    await this.exclusive(key, async () => { await this.store.remove(key); });
  }

  private redirect(record: ManagedMcpRecord) {
    const oauth = record.config.oauth || {};
    return oauth.redirectUri ?? `http://127.0.0.1:${oauth.callbackPort ?? 19876}/mcp/oauth/callback`;
  }
  private provider(record: ManagedMcpRecord, pending?: PendingAuthorization): OAuthClientProvider {
    const runtime = this.runtime(record);
    const oauth = record.config.oauth || {};
    const redirectUri = pending?.redirectUri ?? this.redirect(record);
    const assertCurrent = () => {
      runtime.controller.signal.throwIfAborted();
      if (pending && pending.expiresAt <= Date.now()) throw new ApiError(400, "mcp_oauth_expired", "This sign-in attempt expired. Start again.");
      return this.current(record.key, record.revision);
    };
    return {
      redirectUrl: redirectUri,
      get clientMetadata(): OAuthClientMetadata { return {
        client_name: "LegalWork", redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: oauth.clientSecret ? "client_secret_post" : "none", ...(oauth.scope ? { scope: oauth.scope } : {}),
      }; },
      state: () => { if (!pending) throw signin(); return pending.state; },
      clientInformation: () => { const current = assertCurrent(); return oauth.clientId ? { client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}) } : current.client; },
      saveClientInformation: async client => { await this.store.put({ ...assertCurrent(), client }); },
      tokens: () => pending ? undefined : assertCurrent().tokens,
      saveTokens: async tokens => {
        const current = assertCurrent();
        const merged: OAuthTokens = { ...tokens, ...(!tokens.refresh_token && !pending && current.tokens?.refresh_token ? { refresh_token: current.tokens.refresh_token } : {}),
          ...(!tokens.scope && !pending && current.tokens?.scope ? { scope: current.tokens.scope } : {}) };
        await this.store.put({ ...current, tokens: merged, expiresAt: tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000,
          issuer: pending?.discovery?.authorizationServerUrl.toString() ?? current.issuer, reconnectRequired: false });
      },
      redirectToAuthorization: url => { if (!pending) throw signin(); pending.authorizationUrl = url.toString(); },
      saveCodeVerifier: verifier => { if (!pending) throw signin(); pending.verifier = verifier; },
      codeVerifier: () => { if (!pending?.verifier || pending.expiresAt <= Date.now()) throw signin(); return pending.verifier; },
      discoveryState: () => pending?.discovery ?? runtime.discovery,
      saveDiscoveryState: discovery => { if (pending) pending.discovery = discovery; else runtime.discovery = discovery; },
      invalidateCredentials: async scope => {
        const current = assertCurrent();
        if (!pending && (scope === "all" || scope === "tokens")) await this.store.put({ ...current, tokens: undefined, expiresAt: undefined, reconnectRequired: true });
        if (scope === "all" || scope === "client") await this.store.put({ ...assertCurrent(), client: undefined });
        if (scope === "all" || scope === "discovery") runtime.discovery = undefined;
        if (scope === "all" || scope === "verifier") { if (pending) pending.verifier = undefined; }
      },
    };
  }
  private network(record: ManagedMcpRecord, timeoutMs = 30_000) {
    const runtime = this.runtime(record);
    return (input: string | URL | Request, init?: RequestInit) => providerFetch(input, {
      ...init, signal: AbortSignal.any([runtime.controller.signal, ...(timeoutMs ? [AbortSignal.timeout(timeoutMs)] : []), ...(init?.signal ? [init.signal] : [])]),
    });
  }

  async startAuthorization(workspaceId: string, name: string) {
    const found = await this.find(workspaceId, name);
    if (!found) throw missing();
    return this.exclusive(found.record.key, async () => {
      const record = this.current(found.record.key);
      if (record.config.oauth === false || record.config.enabled === false) throw new ApiError(400, "mcp_oauth_disabled", "Enable OAuth for this connector before signing in.");
      const runtime = this.runtime(record);
      const pending: PendingAuthorization = { state: randomBytes(32).toString("base64url"), expiresAt: Date.now() + 5 * 60_000, revision: record.revision, redirectUri: this.redirect(record) };
      runtime.pending = pending;
      await auth(this.provider(record, pending), { serverUrl: record.config.url, scope: record.config.oauth?.scope, fetchFn: this.network(record) });
      if (!pending.authorizationUrl) throw new Error("The MCP provider did not return a sign-in link.");
      return { authorizationUrl: pending.authorizationUrl, oauthState: pending.state };
    });
  }

  async finishAuthorization(workspaceId: string, name: string, code: string, state: string) {
    const found = await this.find(workspaceId, name);
    if (!found) throw missing();
    await this.exclusive(found.record.key, async () => {
      const record = this.current(found.record.key);
      const runtime = this.runtime(record), pending = runtime.pending;
      if (!code || !pending || !tokensMatch(pending.state, state) || pending.expiresAt <= Date.now() || pending.revision !== record.revision) throw new ApiError(400, "mcp_oauth_state_invalid", "This sign-in attempt expired or changed. Start again.");
      runtime.pending = undefined; // Every callback is single-use, including failed exchanges.
      await auth(this.provider(record, pending), { serverUrl: record.config.url, authorizationCode: code, fetchFn: this.network(record) });
      runtime.discovery = pending.discovery;
      await runtime.client?.close();
      runtime.client = undefined;
      runtime.failedAt = undefined;
      await Promise.allSettled(Array.from(this.closeGateways, close => close(record.id)));
    });
    await this.client(found.record);
    return { status: "connected" };
  }

  async logout(workspaceId: string, name: string) {
    const found = await this.find(workspaceId, name);
    if (!found) return;
    const { record } = found;
    // Fence and cancel first; a refresh already in flight cannot commit afterward.
    await this.retire(record);
    await this.exclusive(record.key, async () => {
      const current = this.store.get(record.key);
      if (!current || current.id !== record.id) return;
      await this.store.put({ ...current, revision: randomUUID(), tokens: undefined, expiresAt: undefined, reconnectRequired: true });
    });
  }

  private async tokenFor(record: ManagedMcpRecord, rejectedAccessToken?: string): Promise<string | undefined> {
    return this.exclusive(record.key, async () => {
      const current = this.current(record.key, record.revision);
      const runtime = this.runtime(current);
      runtime.controller.signal.throwIfAborted();
      if (current.reconnectRequired) throw signin();
      if (!current.tokens) return undefined;
      if (rejectedAccessToken && current.tokens.access_token !== rejectedAccessToken) return current.tokens.access_token;
      const expirySkew = Math.min(30_000, (current.tokens.expires_in ?? 0) * 100);
      if (!rejectedAccessToken && (current.expiresAt === undefined || current.expiresAt > Date.now() + expirySkew)) return current.tokens.access_token;
      if (runtime.refreshRetryAt && runtime.refreshRetryAt > Date.now()) throw new ApiError(503, "mcp_retry_later", "Token refresh is temporarily unavailable. Retry shortly.");
      if (!current.tokens.refresh_token) { await this.store.put({ ...current, tokens: undefined, reconnectRequired: true }); throw signin(); }
      const provider = this.provider(current);
      try {
        // Discover once using the SDK without allowing runtime requests to register
        // a new client or open a browser. The cached issuer binds later refreshes.
        if (!runtime.discovery) {
          const { discoverOAuthServerInfo } = await import("@modelcontextprotocol/sdk/client/auth.js");
          runtime.discovery = await discoverOAuthServerInfo(current.config.url, { fetchFn: this.network(current) });
        }
        const discovery = runtime.discovery;
        if (current.issuer && current.issuer !== discovery.authorizationServerUrl.toString()) throw signin();
        const clientInformation = await provider.clientInformation();
        if (!clientInformation) throw signin();
        const resource = await selectResourceURL(current.config.url, provider, discovery.resourceMetadata);
        const tokens = await refreshAuthorization(discovery.authorizationServerUrl, {
          metadata: discovery.authorizationServerMetadata, clientInformation, refreshToken: current.tokens.refresh_token,
          resource, fetchFn: this.network(current),
        });
        await provider.saveTokens(tokens);
        runtime.refreshRetryAt = undefined;
        return tokens.access_token;
      } catch (error) {
        if (error instanceof InvalidGrantError || error instanceof InvalidClientError) {
          runtime.controller.signal.throwIfAborted();
          await this.store.put({ ...this.current(current.key, current.revision), tokens: undefined, expiresAt: undefined, reconnectRequired: true });
          runtime.status = { status: "needs_auth", error: signin().message };
          throw signin();
        }
        runtime.refreshRetryAt = Date.now() + 3000;
        throw error;
      }
    });
  }

  private authenticatedFetch(record: ManagedMcpRecord) {
    return async (input: string | URL | Request, init?: RequestInit) => {
      const current = this.current(record.key, record.revision);
      const headers = new Headers(init?.headers);
      for (const [key, value] of Object.entries(current.config.headers ?? {})) headers.set(key, value);
      const token = current.config.oauth === false ? undefined : await this.tokenFor(record);
      if (token) headers.set("authorization", `Bearer ${token}`);
      const request = () => this.network(record, 0)(input, { ...init, headers });
      let response = await request();
      // An explicit HTTP 401 rejects the request before execution. Never retry
      // network failures, MCP errors, or an ambiguous tool result.
      if (response.status === 401 && current.config.oauth !== false) {
        await response.body?.cancel();
        if (!token) { this.runtime(record).status = { status: "needs_auth", error: signin().message }; throw signin(); }
        const replacement = await this.tokenFor(record, token);
        headers.set("authorization", `Bearer ${replacement}`);
        response = await request();
        if (response.status === 401) {
          const invalidated = await this.exclusive(record.key, async () => {
            const current = this.current(record.key, record.revision);
            if (current.tokens?.access_token !== replacement) return false;
            await this.store.put({ ...current, tokens: undefined, expiresAt: undefined, reconnectRequired: true });
            return true;
          });
          if (invalidated) {
            await response.body?.cancel();
            this.runtime(record).status = { status: "needs_auth", error: signin().message };
            throw signin();
          }
        }
      }
      return response;
    };
  }

  async client(record: ManagedMcpRecord): Promise<Client> {
    const current = this.current(record.key, record.revision);
    const runtime = this.runtime(current);
    if (current.config.enabled === false) throw new ApiError(409, "mcp_disabled", "This connector is disabled.");
    if (current.reconnectRequired) throw signin();
    if (runtime.client) return runtime.client;
    if (runtime.connecting) return runtime.connecting;
    if (runtime.failedAt && Date.now() - runtime.failedAt < 3000) throw new ApiError(503, "mcp_retry_later", "The connector is temporarily unavailable. Retry shortly.");
    runtime.connecting = (async () => {
      const connect = async (legacy: boolean) => {
        const client = new Client({ name: "LegalWork Connector Manager", version: "1.0.0" }, { capabilities: {} });
        const options = { fetch: this.authenticatedFetch(current) };
        const transport = legacy ? new SSEClientTransport(new URL(current.config.url), options) : new StreamableHTTPClientTransport(new URL(current.config.url), options);
        transport.onerror = () => {
          if (runtime.client !== client) return;
          runtime.client = undefined;
          runtime.failedAt = Date.now();
          if (runtime.status.status !== "needs_auth") runtime.status = { status: "failed", error: "The provider connection was interrupted. LegalWork will reconnect it." };
          void client.close().catch(() => {});
        };
        try {
          await client.connect(transport, { signal: runtime.controller.signal, timeout: 30_000 });
          runtime.controller.signal.throwIfAborted();
          client.onclose = () => { if (runtime.client === client) runtime.client = undefined; };
          runtime.client = client;
          runtime.status = { status: "connected" };
          runtime.failedAt = undefined;
          for (const listener of this.connectedListeners) listener(current.id, client);
          return client;
        } catch (error) { await client.close().catch(() => {}); throw error; }
      };
      try { return await connect(false); }
      catch (error) {
        // Only a transport mismatch can fall back to legacy SSE. Authentication
        // failure never starts a second OAuth flow or repeats a tool call.
        if (error instanceof StreamableHTTPError && [404, 405].includes(error.code ?? 0)) return await connect(true);
        runtime.failedAt = Date.now();
        if (runtime.status.status !== "needs_auth") runtime.status = { status: error instanceof UnauthorizedError ? "needs_auth" : "failed", error: "The connector could not connect. Check its connection in LegalWork." };
        throw error;
      }
    })();
    try { return await runtime.connecting; } finally { runtime.connecting = undefined; }
  }

  async status(workspaceId: string, name: string) {
    let found;
    try { found = await this.find(workspaceId, name); }
    catch (error) { if (isMcpSecureStorageError(error)) return { status: "failed", error: error.message }; throw error; }
    if (!found) return undefined;
    const current = this.current(found.record.key);
    if (current.config.enabled === false) return { status: "disabled" };
    if (current.reconnectRequired) return { status: "needs_auth", error: signin().message };
    return this.runtime(current).status;
  }
  async gatewayConnection(workspaceId: string, id: string) {
    if (!this.config.workspaces.some(workspace => workspace.id === workspaceId && workspace.workspaceType !== "remote")) throw missing();
    await this.ready();
    const record = this.store.all().find(item => item.id === id);
    if (!record) throw missing();
    const key = z.tuple([z.string(), z.string()]).parse(JSON.parse(record.key));
    const found = await this.find(workspaceId, key[1]);
    if (!found || found.record.id !== id) throw missing();
    return found.record;
  }

  async close() {
    this.closed = true;
    this.lifetime.abort();
    this.stopFirmEvents();
    await this.opening?.catch(() => {});
    for (const record of this.store.all()) await this.retire(record);
    await Promise.allSettled(this.queues.values());
    await Promise.allSettled(this.configurationMutations.values());
    await this.store.drain();
    this.store.close();
    this.secret.fill(0);
  }
}

export function initializeMcpManager(config: ServerConfig) {
  let manager = managers.get(config);
  if (!manager) { manager = new McpConnectorManager(config); managers.set(config, manager); }
  return manager;
}
export function mcpManager(config: ServerConfig) { return managers.get(config); }
export async function stopMcpManager(config: ServerConfig) {
  const manager = managers.get(config);
  await manager?.close();
  if (managers.get(config) === manager) managers.delete(config);
}
export async function managedMcpEngineEntries(config: ServerConfig, workspaceId: string, entries: Record<string, Record<string, unknown>>) {
  const manager = managers.get(config);
  return manager ? manager.engineEntries(workspaceId, entries) : entries;
}
