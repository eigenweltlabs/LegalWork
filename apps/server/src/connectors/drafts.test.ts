import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { EmailDraftInputSchema, EmailDraftSchema } from "@legalwork/types/email-draft";
import { CalendarEventDraftSchema } from "@legalwork/types/calendar-event-draft";
import type { ServerConfig } from "../types.js";
import { startServer } from "../server.js";
import { writeEigenweltConnection } from "../eigenwelt-connection-store.js";
import { writeConnectorConnections } from "./store.js";
import { recordConnectorActivation, saveConnectorWriteSetting } from "./settings.js";
import { prepareConnectorEmailDraft, prepareConnectorCalendarDraft, deliverConnectorEmailDraft, deliverConnectorCalendarDraft } from "./drafts.js";
import { readDraft, saveEmailDraft } from "../email-drafts/store.js";
import { callConnectorExtensionAction } from "./index.js";

const nativeFetch = globalThis.fetch;
const prior = new Map(["EIGENWELT_PLATFORM_URL", "LEGALWORK_RUNTIME_DB", "LEGALWORK_TOKEN_STORE"].map(key => [key, process.env[key]]));
let root: string, config: ServerConfig;
let requests: { url: URL; method: string; body: string }[];
let changed = false, failSend = false;
const stops: (() => Promise<unknown> | unknown)[] = [];
const owner = JSON.stringify(["https://draft-broker.test", "firm", "user"]);
const email = { to: ["client@example.com"], cc: ["team@example.com"], bcc: ["archive@example.com"], subject: "Review Grüße", body: "Please review.", html: "<p>Please review.</p>", attachments: [{ path: "attachment.txt", contentType: "text/plain" }] };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "connected-drafts-"));
  process.env.EIGENWELT_PLATFORM_URL = "https://draft-broker.test";
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  config = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "project", path: root, name: "Fixture project", preset: "starter", workspaceType: "local" }, { id: "other", path: root, name: "Other", preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false,
    startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  await writeFile(join(root, "attachment.txt"), "Synthetic attachment");
  await writeEigenweltConnection(config, { platformToken: "fixture-platform-token", platformURL: "https://draft-broker.test", account: { userId: "user", userName: "Fixture", userEmail: null, orgId: "firm", orgName: "Fixture" } });
  for (const id of ["gmail", "outlook", "google-calendar"]) await writeConnectorConnections(config, owner, id, [{ id: `${id}-account`, nangoConnectionId: `${id}-private`, createdAt: null, needsReconnect: false }]);
  for (const id of ["gmail", "outlook", "google-calendar", "outlook-calendar"]) await saveConnectorWriteSetting(config, id, { writeAccess: true });
  for (const id of ["outlook", "outlook-calendar"]) await recordConnectorActivation(config, id, "outlook-account", true);
  requests = []; changed = false; failSend = false;
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "127.0.0.1") return nativeFetch(input, init);
    const body = init?.body instanceof Blob ? await init.body.text() : String(init?.body ?? "");
    const method = init?.method ?? "GET";
    requests.push({ url, body, method });
    if (url.hostname === "draft-broker.test") {
      if (url.pathname.endsWith("/token")) return Response.json({ accessToken: "fixture-access", expiresAt: null });
      if (url.pathname.endsWith("/connection/status")) {
        const fields = z.object({ connectionId: z.string() }).parse(JSON.parse(body));
        return Response.json({ connection: { id: fields.connectionId, createdAt: null, needsReconnect: false } });
      }
      throw new Error("Unexpected credential broker request");
    }
    if (url.hostname === "gmail.googleapis.com") {
      if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "fixture@example.com" });
      if (url.pathname.endsWith("/drafts/send")) return failSend ? new Response(null, { status: 500 }) : Response.json({ id: "sent-message", threadId: "sent-thread" });
      if (method === "GET") return Response.json({ message: { id: changed ? "changed-message" : "gmail-message" } });
      return Response.json({ id: "gmail-draft", message: { id: "gmail-message", threadId: "gmail-thread" } });
    }
    if (url.hostname === "www.googleapis.com") {
      const event = z.object({ summary: z.string(), start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }), end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }) }).parse(JSON.parse(body));
      return Response.json({ ...event, id: "google-event", htmlLink: "https://calendar.google.com/calendar/event?eid=fixture" });
    }
    if (url.hostname === "graph.microsoft.com") {
      if (url.pathname.endsWith("/send")) return failSend ? new Response(null, { status: 500 }) : new Response(null, { status: 202 });
      if (url.pathname.endsWith("/events")) return Response.json({ ...JSON.parse(body), id: "outlook-event", webLink: "https://outlook.office.com/calendar/item/fixture" });
      if (method === "GET") return Response.json({ isDraft: true, changeKey: changed ? "changed-version" : "outlook-version" });
      return Response.json({ id: "outlook-draft", changeKey: "outlook-version", webLink: "https://outlook.office.com/mail/item/fixture" });
    }
    throw new Error("Unexpected provider request");
  }, { preconnect: nativeFetch.preconnect });
});
afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  globalThis.fetch = nativeFetch;
  for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(root, { recursive: true, force: true });
});
const workspace = () => config.workspaces[0];
const prepareMail = async (id = "gmail") => prepareConnectorEmailDraft(config, id, email, { directory: root });

test("connector create actions return the shared editable cards and make no provider or credential request", async () => {
  for (const id of ["gmail", "outlook"] satisfies Array<"gmail" | "outlook">) {
    const result = await callConnectorExtensionAction(config, id, "create_draft", email, { directory: root });
    const draft = EmailDraftSchema.parse(z.object({ draft: z.unknown() }).parse(result.result).draft);
    expect(draft.connectorTarget?.connectorId).toBe(id);
    expect(draft.delivery).toBeUndefined();
    const updated = await saveEmailDraft(root, workspace().id, EmailDraftInputSchema.parse({ ...draft, subject: "Human edit" }), { id: draft.id, revision: draft.revision });
    expect(updated.connectorTarget).toEqual(draft.connectorTarget);
    expect(updated.revision).not.toBe(draft.revision);
  }
  for (const id of ["google-calendar", "outlook-calendar"] satisfies Array<"google-calendar" | "outlook-calendar">) {
    const result = await callConnectorExtensionAction(config, id, "create_event", { title: "Review", start: "2026-10-14T10:00:00+02:00", end: "2026-10-14T11:00:00+02:00" }, { directory: root });
    const draft = CalendarEventDraftSchema.parse(z.object({ draft: z.unknown() }).parse(result.result).draft);
    expect(draft.connectorTarget?.connectorId).toBe(id);
    expect(draft.delivery).toBeUndefined();
  }
  expect(requests).toHaveLength(0);
});

test("saving and sending reuse the rendered MIME including HTML, Cc, Bcc and attachments, and never send twice", async () => {
  for (const id of ["gmail", "outlook"] satisfies Array<"gmail" | "outlook">) {
    const { draft } = await prepareMail(id);
    const saved = await deliverConnectorEmailDraft(config, workspace(), draft.id, draft.revision, "save");
    expect(saved.draft.delivery?.state).toBe("saved");
    if (id === "gmail") expect(new URL(saved.draft.delivery?.webUrl ?? "").searchParams.get("authuser")).toBe("fixture@example.com");
    expect(requests.filter(item => item.url.pathname.endsWith("/send"))).toHaveLength(id === "gmail" ? 0 : 1);
    const create = requests.slice().reverse().find(item => item.method === "POST" && item.url.hostname !== "draft-broker.test" && !item.url.pathname.endsWith("/send"));
    if (!create) throw new Error("Expected direct provider draft creation");
    const mime = id === "gmail" ? Buffer.from(z.object({ message: z.object({ raw: z.string() }) }).parse(JSON.parse(create.body)).message.raw, "base64url").toString() : Buffer.from(create.body, "base64").toString();
    expect(mime).toContain("multipart/mixed"); expect(mime).toContain("multipart/alternative"); expect(mime).toContain("archive@example.com");
    expect(mime).toContain(Buffer.from("Synthetic attachment").toString("base64"));
    await expect(deliverConnectorEmailDraft(config, workspace(), draft.id, draft.revision, "send")).rejects.toMatchObject({ code: "draft_conflict" });
    const attempts = await Promise.allSettled([0, 1].map(() => deliverConnectorEmailDraft(config, workspace(), draft.id, saved.draft.revision, "send")));
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const sent = EmailDraftSchema.parse(await readDraft(root, draft.id));
    expect(sent.delivery?.state).toBe("sent");
    await expect(deliverConnectorEmailDraft(config, workspace(), sent.id, sent.revision, "send")).rejects.toMatchObject({ code: "connector_draft_sent" });
    await expect(saveEmailDraft(root, workspace().id, EmailDraftInputSchema.parse(sent), { id: sent.id, revision: sent.revision })).rejects.toMatchObject({ code: "connector_draft_closed" });
  }
  expect(requests.filter(item => item.url.hostname === "gmail.googleapis.com" && item.url.pathname.endsWith("/send"))).toHaveLength(1);
  expect(requests.filter(item => item.url.hostname === "graph.microsoft.com" && item.url.pathname.endsWith("/send"))).toHaveLength(1);
  expect(requests.filter(item => item.url.hostname === "draft-broker.test").every(item => !item.body.includes("client@example.com") && !item.body.includes("Please review"))).toBe(true);
});

test("sending directly from a preview saves the draft first, while wrong connectors and stale local exports fail before mutations", async () => {
  const { draft } = await prepareMail();
  await expect(deliverConnectorEmailDraft(config, workspace(), draft.id, draft.revision, "send", "outlook")).rejects.toMatchObject({ code: "connector_draft_provider" });
  expect(requests).toHaveLength(0);
  await writeFile(join(root, draft.path), "Changed export");
  await expect(deliverConnectorEmailDraft(config, workspace(), draft.id, draft.revision, "send")).rejects.toMatchObject({ code: "connector_draft_changed" });
  expect(requests.every(item => item.url.hostname === "draft-broker.test")).toBe(true);
  const next = await prepareMail();
  const sent = await deliverConnectorEmailDraft(config, workspace(), next.draft.id, next.draft.revision, "send");
  expect(sent.draft.delivery?.state).toBe("sent");
});

test("write settings, independent Outlook activation, and account replacement block delivery before remote requests", async () => {
  const mail = await prepareMail("outlook");
  await saveConnectorWriteSetting(config, "outlook", { writeAccess: false });
  await expect(deliverConnectorEmailDraft(config, workspace(), mail.draft.id, mail.draft.revision, "send")).rejects.toMatchObject({ code: "connector_writes_disabled" });
  await saveConnectorWriteSetting(config, "outlook", { writeAccess: true });
  await recordConnectorActivation(config, "outlook", "outlook-account", false);
  await expect(deliverConnectorEmailDraft(config, workspace(), mail.draft.id, mail.draft.revision, "save")).rejects.toMatchObject({ code: "connector_inactive" });
  await expect(prepareConnectorEmailDraft(config, "outlook", email, { directory: root })).rejects.toMatchObject({ code: "connector_inactive" });
  await writeConnectorConnections(config, owner, "outlook", [{ id: "replacement", nangoConnectionId: "replacement-private", createdAt: null, needsReconnect: false }]);
  await expect(deliverConnectorEmailDraft(config, workspace(), mail.draft.id, mail.draft.revision, "send")).rejects.toMatchObject({ code: "connector_connection_not_found" });
  expect(requests).toHaveLength(0);
});

test("provider edits stop sends, and an ambiguous send failure persists across reloads without automatic retries", async () => {
  for (const id of ["gmail", "outlook"] satisfies Array<"gmail" | "outlook">) {
    const { draft } = await prepareMail(id);
    const saved = await deliverConnectorEmailDraft(config, workspace(), draft.id, draft.revision, "save");
    changed = true;
    await expect(deliverConnectorEmailDraft(config, workspace(), draft.id, saved.draft.revision, "send")).rejects.toMatchObject({ code: "connector_draft_changed" });
    changed = false; failSend = true;
    await expect(deliverConnectorEmailDraft(config, workspace(), draft.id, saved.draft.revision, "send")).rejects.toMatchObject({ code: "connector_api_failed" });
    const latest = EmailDraftSchema.parse(await readDraft(root, draft.id));
    expect(latest.delivery?.state).toBe("uncertain");
    const before = requests.length;
    await expect(deliverConnectorEmailDraft({ ...config }, workspace(), draft.id, latest.revision, "send")).rejects.toMatchObject({ code: "connector_delivery_uncertain" });
    expect(requests).toHaveLength(before);
  }
  expect(requests.filter(item => item.url.pathname.endsWith("/send"))).toHaveLength(2);
});

test("calendar delivery preserves date, time zone, reminders and selected calendar without invitations or duplicate entries", async () => {
  for (const id of ["google-calendar", "outlook-calendar"] satisfies Array<"google-calendar" | "outlook-calendar">) {
    const { draft } = await prepareConnectorCalendarDraft(config, id, { title: "Review", calendarId: "chosen-calendar", start: "2026-10-14", end: "2026-10-15", allDay: true, timeZone: "Europe/Berlin", reminders: [30] }, { directory: root });
    const saved = await deliverConnectorCalendarDraft(config, workspace(), draft.id, draft.revision);
    expect(saved.draft.delivery?.state).toBe("saved");
    const count = requests.length;
    await deliverConnectorCalendarDraft(config, workspace(), draft.id, saved.draft.revision);
    expect(requests).toHaveLength(count);
    const post = requests.slice().reverse().find(item => item.url.hostname !== "draft-broker.test");
    if (!post) throw new Error("Expected calendar creation");
    expect(post.url.pathname).toContain("chosen-calendar");
    expect(post.body).not.toContain("client@example.com");
    expect(post.body).toContain(id === "google-calendar" ? '"minutes":30' : '"reminderMinutesBeforeStart":30');
    if (id === "outlook-calendar") expect(post.body).toContain('"timeZone":"Europe/Berlin"');
  }
});

test("delivery routes require host ownership, validate revisions and workspace, and honor read-only mode", async () => {
  const { draft } = await prepareMail();
  const server = await startServer(config); stops.push(() => server.stop());
  const path = `http://127.0.0.1:${server.port}/workspace/project/connector-drafts/email/${draft.id}/deliver`;
  const body = JSON.stringify({ revision: draft.revision, operation: "send" });
  const headers = { "Content-Type": "application/json", "X-LegalWork-Host-Token": "host" };
  expect((await nativeFetch(path, { method: "POST", body })).status).toBe(401);
  expect((await nativeFetch(path, { method: "POST", body, headers: { "Content-Type": "application/json", Authorization: "Bearer client" } })).status).toBe(401);
  expect((await nativeFetch(path.replace("/project/", "/other/"), { method: "POST", body, headers })).status).toBe(404);
  expect((await nativeFetch(path, { method: "POST", body: JSON.stringify({ revision: "invalid", operation: "send" }), headers })).status).toBe(400);
  config.readOnly = true;
  expect((await nativeFetch(path, { method: "POST", body, headers })).status).toBe(403);
  config.readOnly = false;
  const result = await nativeFetch(path, { method: "POST", body, headers });
  expect(result.status).toBe(200);
  expect(z.object({ draft: EmailDraftSchema }).parse(await result.json()).draft.delivery?.state).toBe("sent");
  expect((await readFile(join(root, draft.path), "utf8"))).toContain("X-Unsent: 1");
});
