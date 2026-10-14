// Isolated local fixture: real LegalWork routes, simulated auth broker and provider APIs.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startServer } from "../src/server.js";
import { writeEigenweltConnection } from "../src/eigenwelt-connection-store.js";
import type { ServerConfig } from "../src/types.js";
import { writeConnectorConnections } from "../src/connectors/store.js";
import { connectorDefinitions } from "../src/connectors/schema.js";
import { recordConnectorActivation, saveConnectorWriteSetting } from "../src/connectors/settings.js";
import { prepareConnectorEmailDraft, prepareConnectorCalendarDraft } from "../src/connectors/drafts.js";

const root = await mkdtemp(join(tmpdir(), "legalwork-connector-preview-"));
const showDrafts = process.env.LEGALWORK_CONNECTOR_PREVIEW_DRAFTS === "1";
process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
process.env.LEGALWORK_ENV_STORE = join(root, "env.json");
process.env.EIGENWELT_PLATFORM_URL = "https://connector-fixture.test";
const config: ServerConfig = { host: "127.0.0.1", port: 44641, token: "fixture-client", hostToken: "fixture-host",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [],
  readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
if (showDrafts) { config.workspaces = [{ id: "fixture-project", name: "Synthetic drafts", path: root, preset: "starter", workspaceType: "local" }]; config.authorizedRoots = [root]; }
if (process.env.LEGALWORK_CONNECTOR_PREVIEW_SIGNED_OUT !== "1") {
  await writeEigenweltConnection(config, { platformToken: "fixture-platform-token", platformURL: "https://connector-fixture.test",
    account: { userId: "fixture-user", userName: "Local fixture", userEmail: null, orgId: "fixture-firm", orgName: "Local fixture" } });
}
const nativeFetch = globalThis.fetch;
const connected = new Set<string>();
let startingProvider = "gmail";
const sockets = new Set<FixtureSocket>();
class FixtureSocket extends EventTarget {
  provider: string;
  constructor(url: string) {
    super();
    if (url !== "wss://api.nango.dev/") throw new Error("Unexpected fixture auth transport");
    this.provider = startingProvider; sockets.add(this);
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ message_type: "connection_ack", ws_client_id: "fixture-socket" }) })));
  }
  authorize() {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ message_type: "success", provider_config_key: this.provider, connection_id: `${this.provider}-fixture-account` }) }));
  }
  close() { sockets.delete(this); this.dispatchEvent(new Event("close")); }
}
Object.defineProperty(globalThis, "WebSocket", { value: FixtureSocket });
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (showDrafts && url.hostname === "gmail.googleapis.com") {
    if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "fixture@example.com" });
    if (url.pathname.endsWith("/send")) return Response.json({ id: "fixture-sent-message", threadId: "fixture-sent-thread" });
    if (init?.method === "POST") return Response.json({ id: "fixture-gmail-draft", message: { id: "fixture-gmail-message", threadId: "fixture-gmail-thread" } });
    return Response.json({ message: { id: "fixture-gmail-message" } });
  }
  if (showDrafts && url.hostname === "www.googleapis.com") {
    const data = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ id: "fixture-google-event", summary: data.summary, start: data.start, end: data.end, htmlLink: "https://calendar.google.com/calendar/event?eid=fixture" });
  }
  if (showDrafts && url.hostname === "graph.microsoft.com") {
    if (url.pathname.endsWith("/send")) return new Response(null, { status: 202 });
    if (url.pathname.endsWith("/events")) return Response.json({ ...JSON.parse(String(init?.body ?? "{}")), id: "fixture-outlook-event", webLink: "https://outlook.office.com/calendar/item/fixture" });
    return init?.method === "POST" ? Response.json({ id: "fixture-outlook-draft", changeKey: "fixture-version", webLink: "https://outlook.office.com/mail/item/fixture" }) : Response.json({ isDraft: true, changeKey: "fixture-version" });
  }
  if (url.hostname === "oauth2.googleapis.com" || url.hostname === "login.microsoftonline.com") {
    return Response.json({ access_token: "fixture-direct-token", refresh_token: "fixture-direct-refresh", expires_in: 3600 });
  }
  if (url.hostname === "gmail.googleapis.com") return Response.json({ emailAddress: "fixture@example.com" });
  if (url.hostname === "graph.microsoft.com") return Response.json({ value: [] });
  if (url.hostname !== "connector-fixture.test") return nativeFetch(input, init);
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments[2] === "outlook-calendar" ? "outlook" : segments[2];
  if (segments.length === 2) return Response.json({ configured: true, providers: showDrafts ? connectorDefinitions.map(({ id }) => ({ id })) : [{ id: "gmail" }, { id: "outlook" }] });
  if (segments.at(-1) === "connect" || segments.at(-1) === "reconnect") {
    const body = z.object({ flowId: z.string() }).parse(typeof init?.body === "string" ? JSON.parse(init.body) : {});
    startingProvider = id;
    return Response.json({ sessionToken: "fixture-only", integrationId: id, expiresAt: Date.now() + 5 * 60_000 });
  }
  if (segments.at(-1) === "token") return Response.json({ accessToken: "fixture-mail-token", expiresAt: null });
  if (segments.at(-1) === "disconnect") { connected.delete(id); return Response.json({ ok: true }); }
  return connected.has(id) ? Response.json({ connection: { id: `${id}-fixture-account`, createdAt: new Date().toISOString(), needsReconnect: false } }) : Response.json({}, { status: 404 });
}, { preconnect: nativeFetch.preconnect });
const server = await startServer(config);
const fixtureDrafts = showDrafts ? await (async () => {
  const owner = JSON.stringify(["https://connector-fixture.test", "fixture-firm", "fixture-user"]);
  for (const id of ["gmail", "outlook", "google-calendar"]) {
    connected.add(id);
    await writeConnectorConnections(config, owner, id, [{ id: `${id}-fixture-local`, nangoConnectionId: `${id}-fixture-account`, createdAt: null, needsReconnect: false }]);
  }
  for (const id of ["gmail", "outlook", "google-calendar", "outlook-calendar"]) await saveConnectorWriteSetting(config, id, { writeAccess: true });
  for (const id of ["outlook", "outlook-calendar"]) await recordConnectorActivation(config, id, "outlook-fixture-local", true);
  const email = { to: ["client@example.com"], subject: "Contract review", body: "Hello,\n\nPlease review the revised agreement before our meeting.\n\nBest regards" };
  const event = { title: "Contract review meeting", start: "2026-10-15T14:00:00+02:00", end: "2026-10-15T15:00:00+02:00", timeZone: "Europe/Berlin", location: "Office", description: "Review the revised agreement.", reminders: [15] };
  return { workspaceId: "fixture-project", gmail: (await prepareConnectorEmailDraft(config, "gmail", email, { directory: root })).draft,
    outlook: (await prepareConnectorEmailDraft(config, "outlook", email, { directory: root })).draft,
    "google-calendar": (await prepareConnectorCalendarDraft(config, "google-calendar", event, { directory: root })).draft,
    "outlook-calendar": (await prepareConnectorCalendarDraft(config, "outlook-calendar", event, { directory: root })).draft };
})() : null;
const authorization = Bun.serve({ hostname: "127.0.0.1", port: 44642, async fetch(request) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (new URL(request.url).pathname === "/fixture/drafts" && request.method === "GET") return Response.json(fixtureDrafts, { headers });
  const body = z.object({ provider: z.enum(["gmail", "outlook"]), authUrl: z.string().optional() }).parse(await request.json());
  if (body.authUrl) {
    const auth = new URL(body.authUrl);
    if (auth.hostname === "accounts.google.com" || auth.hostname === "login.microsoftonline.com") {
      const callback = new URL(auth.searchParams.get("redirect_uri")!);
      if (!((callback.hostname === "localhost" || callback.hostname === "127.0.0.1") && callback.protocol === "http:" && callback.port === "53683" && callback.pathname === "/callback")) {
        return new Response("Invalid fixture callback", { status: 400, headers });
      }
      callback.search = new URLSearchParams({ code: "fixture-code", state: auth.searchParams.get("state")! }).toString();
      const result = await nativeFetch(callback);
      return Response.json({ ok: result.ok }, { headers });
    }
  }
  connected.add(body.provider);
  for (const socket of sockets) if (socket.provider === body.provider) socket.authorize();
  return Response.json({ ok: true }, { headers });
} });
// Consent is simulated on a separate port; no test routes are added to the product.
console.log("Connector fixture running: LegalWork 44641, simulated consent 44642.");
const cleanup = async () => { authorization.stop(true); await server.stop(); await rm(root, { recursive: true, force: true }); process.exit(0); };
process.once("SIGTERM", cleanup);
process.once("SIGINT", cleanup);
