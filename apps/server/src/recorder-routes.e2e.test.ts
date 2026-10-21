import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { RecorderLiveTranscriptStatus, ServerConfig } from "./types.js";
import { ensureWikiAgentToken, grantWikiAgentSession, revokeWikiAgentSession } from "./wiki/agent-access.js";
import { RECORDING_TOOLS } from "./opencode-plugins/recording-tools.js";
import { PROJECT_TASK_AGENT, ALL_PROJECTS_TASK_AGENT } from "./scheduled-tasks/access.js";

const TOKEN = "recorder_routes_client_token";
const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function startTestServer(withRecorder: boolean) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-recorder-routes-"));
  roots.push(root);
  let status: RecorderLiveTranscriptStatus = {
    available: true,
    recordingActive: true,
    liveTranscriptActive: false,
    fileName: null,
    error: null,
  };
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    hostToken: "recorder_routes_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: true,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "json",
    logRequests: false,
    recorder: withRecorder ? {
      listRecordings: async () => [],
      readRecording: async () => null,
      status: () => status,
      setLiveTranscript: (enabled, workspacePath) => {
        expect(workspacePath).toBe(root);
        status = {
          ...status,
          liveTranscriptActive: enabled,
          fileName: enabled ? "live-call-transcript.md" : null,
        };
        return status;
      },
    } : null,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  return { base, root, config, url: `${base}/workspace/ws_1/recorder/live-transcript` };
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("recorder live transcript routes", () => {
  test("reads and toggles the desktop recorder for an authenticated workspace", async () => {
    const { url } = await startTestServer(true);
    const initial = await fetch(url, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ recordingActive: true, liveTranscriptActive: false });

    const enabled = await fetch(url, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      liveTranscriptActive: true,
      fileName: "live-call-transcript.md",
    });

    const invalid = await fetch(url, { method: "POST", headers, body: JSON.stringify({ enabled: "yes" }) });
    expect(invalid.status).toBe(400);
  });

  test("reports unavailable when LegalWork is not embedded in the desktop app", async () => {
    const { url } = await startTestServer(false);
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, recordingActive: false });
  });
});

describe("recording library access", () => {
  test("only the owner can read the library, with an explicit unavailable response for headless servers", async () => {
    const { base } = await startTestServer(true);
    const owner = { "x-legalwork-host-token": "recorder_routes_host_token" };
    for (const path of ["/recorder/recordings", "/recorder/recordings/example"]) {
      expect((await fetch(base + path)).status).toBe(401);
      expect((await fetch(base + path, { headers })).status).toBe(403);
    }
    const list = await fetch(`${base}/recorder/recordings`, { headers: owner });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ scope: "library", recordings: [], totalMatches: 0, nextCursor: null });
    expect((await fetch(`${base}/recorder/recordings/missing`, { headers: owner })).status).toBe(404);
    expect((await fetch(`${base}/recorder/recordings?limit=1000`, { headers: owner })).status).toBe(400);
    const headless = await startTestServer(false);
    expect((await fetch(`${headless.base}/recorder/recordings`, { headers: owner })).status).toBe(503);
  });

  test("tools inherit the real chat's owner access and immediately lose it on downgrade or revocation", async () => {
    const { base, root, config } = await startTestServer(true);
    const before = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN, agent: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
    process.env.LEGALWORK_SERVER_URL = base;
    process.env.LEGALWORK_SERVER_TOKEN = TOKEN;
    process.env.LEGALWORK_WIKI_AGENT_TOKEN = await ensureWikiAgentToken(config);
    const context = { directory: root, sessionID: "recording-chat" };
    const list = async () => JSON.parse(await RECORDING_TOOLS.legalwork_recordings_list.execute({ period: "yesterday", timeZone: "Europe/Berlin" }, context));
    try {
      expect((await list()).ok).toBe(false);
      await grantWikiAgentSession(config, { sessionId: context.sessionID, directory: root, scope: "owner" });
      const allowed = await list();
      expect(allowed.ok).toBe(true);
      expect(allowed.referenceData.scope).toBe("library");
      expect(allowed.referenceData.filters.timeZone).toBe("Europe/Berlin");
      expect(allowed.referenceData.filters.from).toBe(allowed.referenceData.filters.to);
      const missing = JSON.parse(await RECORDING_TOOLS.legalwork_recording_read.execute({ id: "missing" }, context));
      expect(missing.ok).toBe(false);
      expect(JSON.stringify(missing)).toContain("recording_not_found");
      for (const scope of ["collaborator", "viewer"] satisfies Array<"collaborator" | "viewer">) {
        await grantWikiAgentSession(config, { sessionId: context.sessionID, directory: root, scope });
        expect((await list()).ok).toBe(false);
      }
      await grantWikiAgentSession(config, { sessionId: context.sessionID, directory: root, scope: "owner" });
      for (const agent of [PROJECT_TASK_AGENT, ALL_PROJECTS_TASK_AGENT]) {
        const scheduled = JSON.parse(await RECORDING_TOOLS.legalwork_recordings_list.execute({}, { ...context, agent }));
        expect(scheduled.ok).toBe(false);
        expect(scheduled.error).toContain("scoped to project data");
      }
      revokeWikiAgentSession(config, context.sessionID);
      expect((await list()).ok).toBe(false);
    } finally {
      for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: before.url, LEGALWORK_SERVER_TOKEN: before.token, LEGALWORK_WIKI_AGENT_TOKEN: before.agent })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
