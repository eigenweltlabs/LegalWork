import { afterEach, expect, test } from "bun:test";
import type { FormDetail } from "@opencode/client";
import { z } from "zod";
import { browserPasswordRequestTool } from "./browser-password-request.js";
import { nativePluginTestRuntime, nativeTestInvocation } from "./native-plugin-test-support.js";

const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN };
afterEach(() => {
  if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
  if (previous.token === undefined) delete process.env.LEGALWORK_SERVER_TOKEN; else process.env.LEGALWORK_SERVER_TOKEN = previous.token;
});
const saved = { id: "218d2173-2e4b-4ef2-98e6-52e0367d1d7b", label: "Portal", username: "lawyer" };
async function fixture() {
  const runtime = nativePluginTestRuntime("/fixture/matter"), calls: Array<{ path: string; body: unknown }> = [];
  let passwords: typeof saved[] = [], website = "https://www.example.org", form: FormDetail | undefined, cancelled = 0, connectionChanged = false;
  let subscriber: ReadableStreamDefaultController<Uint8Array> | undefined;
  const emit = (event: unknown) => subscriber?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body: unknown = request.method === "POST" ? await request.json() : null;
    calls.push({ path, body });
    if (path === "/workspace/matter/opencode/api/event") return new Response(new ReadableStream<Uint8Array>({
      start(controller) { subscriber = controller; emit({ id: "evt_fixture", type: "server.connected", data: {} }); },
      cancel() { subscriber = undefined; },
    }), { headers: { "content-type": "text/event-stream" } });
    if (path === "/workspaces") return Response.json({ items: [{ id: "matter", path: "/fixture/matter" }] });
    if (path.endsWith("/sandbox/session/chat")) return Response.json({ enabled: true, networkMode: "allow" });
    if (path.endsWith("/passwords")) {
      expect(request.headers.get("x-legalwork-browser-session")).toBe("chat");
      if (connectionChanged) return new Response(null, { status: 403 });
      return Response.json({ website, passwords });
    }
    if (path === "/workspace/matter/opencode/api/session/chat/form" && request.method === "POST") {
      expect(request.headers.get("authorization")).toBe("Bearer fixture-only");
      const data = z.object({ title: z.string(), metadata: z.record(z.string(), z.json()), fields: z.array(z.json()) }).parse(body);
      form = { id: "form_fixture", sessionID: "chat", title: data.title, metadata: data.metadata,
        fields: [{ key: "password_id", type: "string", hidden: true }, { key: "cancelled", type: "boolean", hidden: true, default: false }], state: { status: "pending" } };
      expect(data.fields).toEqual(form.fields);
      return Response.json({ data: form });
    }
    if (path === "/workspace/matter/opencode/api/session/chat/form/form_fixture" && form) {
      if (request.method === "DELETE") { cancelled++; form = { ...form, state: { status: "cancelled" } }; return new Response(null, { status: 204 }); }
      return Response.json({ data: form });
    }
    return new Response(null, { status: 404 });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; process.env.LEGALWORK_SERVER_TOKEN = "fixture-only";
  const tool = browserPasswordRequestTool(runtime.ctx);
  const input = { browser_url: `${server.url.origin}/${"b".repeat(64)}`, label: "Portal", username: "lawyer" };
  return { runtime, tool, input, calls, get form() { return form; }, get cancelled() { return cancelled; },
    passwords: (value: typeof saved[]) => { passwords = value; }, website: (value: string) => { website = value; },
    changeConnection: () => { connectionChanged = true; },
    async answer(answer: Record<string, string | boolean>) {
      if (!form) throw new Error("No pending form"); form = { ...form, state: { status: "answered", answer } };
      emit({ id: "evt_fixture_reply", type: "form.replied", data: { id: form.id, sessionID: form.sessionID, answer } });
    },
    async ready() { for (let n = 0; n < 100; n++) { if (form) return; await Bun.sleep(5); } throw new Error("The inline request was not created"); },
    async close() { server.stop(true); await runtime.close(); },
  };
}

test("an existing saved login is reused without asking again", async () => {
  const f = await fixture();
  try {
    f.passwords([saved]);
    expect((await f.tool.execute(f.input, nativeTestInvocation("chat"))).output).toEqual({ website: "https://www.example.org", passwords: [saved] });
    expect(f.form).toBeUndefined();
  } finally { await f.close(); }
});

test("inline requests use only native reference fields and resume with verified metadata after a subdomain redirect", async () => {
  const f = await fixture();
  try {
    const pending = f.tool.execute(f.input, nativeTestInvocation("chat")); await f.ready();
    expect(f.form?.metadata).toEqual({ legalworkBrowserPassword: { website: "https://www.example.org", label: "Portal", username: "lawyer" } });
    expect(f.form?.fields.every(field => field.type !== "external" && field.hidden)).toBe(true);
    f.passwords([saved]); f.website("https://auth.example.org");
    await f.answer({ password_id: saved.id, cancelled: false });
    expect((await pending).output).toEqual({ website: "https://auth.example.org", passwords: [saved] });
    expect(f.cancelled).toBe(0);
    expect(f.calls.every(call => !JSON.stringify(call.body).includes('"password":'))).toBe(true);
  } finally { await f.close(); }
});

test("cancel continues without saving or disclosing credentials", async () => {
  const f = await fixture();
  try {
    const pending = f.tool.execute(f.input, nativeTestInvocation("chat")); await f.ready();
    await f.answer({ password_id: "", cancelled: true });
    expect((await pending).output).toEqual({ cancelled: true });
    expect(f.cancelled).toBe(0);
  } finally { await f.close(); }
});

test("a renderer reload resumes with a reconnect instruction instead of losing the saved reference or asking again", async () => {
  const f = await fixture();
  try {
    const pending = f.tool.execute(f.input, nativeTestInvocation("chat")); await f.ready();
    f.changeConnection(); await f.answer({ password_id: saved.id, cancelled: false });
    expect((await pending).output).toMatchObject({ website: "https://www.example.org", password_id: saved.id, status: "reconnect_required" });
    expect(f.cancelled).toBe(0);
  } finally { await f.close(); }
});

test("Stop cancels the pending native card instead of leaving an orphaned request", async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const pending = f.tool.execute(f.input, nativeTestInvocation("chat", controller.signal)); await f.ready();
    controller.abort(new Error("Stopped"));
    await expect(pending).rejects.toThrow();
    expect(f.cancelled).toBe(1);
  } finally { await f.close(); }
});

test("an unrelated website or forged saved ID cannot complete a credential request", async () => {
  const f = await fixture();
  try {
    const pending = f.tool.execute(f.input, nativeTestInvocation("chat")); await f.ready();
    f.website("https://unrelated.example.net"); await f.answer({ password_id: saved.id });
    await expect(pending).rejects.toThrow("website or saved login changed");
    expect(f.cancelled).toBe(0);
  } finally { await f.close(); }
});

test("manual-server extension capabilities cannot request passwords", async () => {
  const f = await fixture();
  try {
    const url = `${process.env.LEGALWORK_SERVER_URL}/workspace/matter/browser/chat/extensions/${"b".repeat(64)}/execute`;
    await expect(f.tool.execute({ browser_url: url }, nativeTestInvocation("chat"))).rejects.toThrow("local LegalWork desktop");
    expect(f.form).toBeUndefined();
  } finally { await f.close(); }
});
