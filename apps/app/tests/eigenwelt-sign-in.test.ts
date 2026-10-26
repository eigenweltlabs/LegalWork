import { afterEach, expect, test } from "bun:test";
import { OpenCode } from "@opencode/client";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { getReactQueryClient } from "../src/react-app/infra/query-client";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  getReactQueryClient().clear();
});

function signInFixture(saveStatus: number, reloadStatus = 200, reloadDelayMs = 0) {
  const requests: string[] = [];
  let scheduledReloads = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path.startsWith("/api/eigenwelt/oauth/wait/")) {
        return Response.json({ apiKey: "test-key", baseURL: "https://example.test/v1", models: [], platformToken: "test-token" });
      }
      if (path.endsWith("/eigenwelt/connection")) {
        return saveStatus === 200
          ? Response.json({})
          : Response.json({ code: "workspace_not_found", message: "Workspace not found" }, { status: saveStatus });
      }
      if (path.endsWith("/engine/reload")) {
        if (reloadDelayMs) await Bun.sleep(reloadDelayMs);
        if (reloadStatus === 404) return Response.json({ code: "workspace_not_found", message: "Workspace not found" }, { status: 404 });
        return reloadStatus === 200
          ? Response.json({ ok: true })
          : Response.json({ code: "opencode_unavailable", message: "Engine is still starting" }, { status: reloadStatus });
      }
      if (path === "/api/location/reload") return new Response(null, { status: 204 });
      if (path === "/api/info") return Response.json({ version: "2.1.4", pid: process.pid });
      if (path === "/api/config") return Response.json([]);
      if (path === "/api/model/default") return Response.json({ location: { directory: "/tmp/sign-in" }, data: null });
      if (["/api/provider", "/api/model", "/api/integration", "/api/mcp"].includes(path)) return Response.json({ location: { directory: "/tmp/sign-in" }, data: [] });
      return new Response("Unexpected route", { status: 500 });
    },
  });
  cleanups.push(() => server.stop(true));
  const client = OpenCode.make({ baseUrl: server.url.href });
  const legalworkClient = createLegalworkServerClient({ baseUrl: server.url.href });
  const store = createProviderAuthStore({
    client: () => client,
    baseUrl: () => server.url.href,
    providers: () => [],
    providerDefaults: () => ({}),
    providerConnectedIds: () => [],
    disabledProviders: () => [],
    selectedWorkspaceDisplay: () => ({ id: "ws", name: "Workspace", path: "/tmp/sign-in", preset: "default", workspaceType: "local" }),
    selectedWorkspaceRoot: () => "/tmp/sign-in",
    runtimeWorkspaceId: () => "ws",
    legalworkServer: { getSnapshot: () => ({
      legalworkServerStatus: "connected",
      legalworkServerClient: legalworkClient,
      legalworkServerCapabilities: { config: { read: true, write: true } },
    }) },
    setProviders: () => undefined,
    setProviderDefaults: () => undefined,
    setProviderConnectedIds: () => undefined,
    setDisabledProviders: () => undefined,
    markOpencodeConfigReloadRequired: () => { scheduledReloads += 1; },
  });
  return { store, requests, scheduledReloads: () => scheduledReloads };
}

test("a failed account save fails sign-in before attempting any engine reload", async () => {
  const fixture = signInFixture(404);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).rejects.toThrow("Workspace not found");
  expect(fixture.store.getSnapshot().providerAuthError).toContain("Workspace not found");
  expect(fixture.requests).toEqual([
    "GET /api/eigenwelt/oauth/wait/test-session",
    "PUT /workspace/ws/eigenwelt/connection",
  ]);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("a successful account save reloads once without scheduling a second reload", async () => {
  const fixture = signInFixture(200);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).resolves.toMatchObject({ connected: true });
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.some((path) => path.endsWith("/api/location/reload"))).toBe(false);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("a removed workspace cannot be recovered by disposing the instance", async () => {
  const fixture = signInFixture(200, 404);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).rejects.toThrow("Workspace not found");
  expect(fixture.requests).toEqual([
    "GET /api/eigenwelt/oauth/wait/test-session",
    "PUT /workspace/ws/eigenwelt/connection",
    "POST /workspace/ws/engine/reload",
  ]);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("cold engine readiness may exceed the ordinary API timeout without a second dispose", async () => {
  const fixture = signInFixture(200, 200, 10_250);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).resolves.toMatchObject({ connected: true });
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.some((path) => path.endsWith("/api/location/reload"))).toBe(false);
}, 15_000);

test("a transient managed refresh failure is surfaced without globally reloading projects", async () => {
  const fixture = signInFixture(200, 503);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).rejects.toThrow();
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.filter((path) => path.endsWith("/api/location/reload"))).toHaveLength(0);
  expect(fixture.scheduledReloads()).toBe(0);
});
