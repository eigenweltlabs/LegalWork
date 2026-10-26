import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloudTranscriptionConnection, cloudTranscriptionStatus } from "./cloud-transcription.js";
import { writeEigenweltConnection } from "./eigenwelt-connection-store.js";
import { writeCachedEigenweltPaidManifest } from "./eigenwelt-paid-manifest.js";
import type { ServerConfig } from "./types.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-cloud-transcription-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = {
    configPath: join(root, "server.json"), host: "127.0.0.1", port: 0, token: "owner", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const model = { model: "gemini-transcribe-live-eu", name: "Gemini", region: "EU", enabled: true, available: true };
  let remote = { baseURL: "https://api.example.com", models: [model] };
  let onRequest = async () => {};
  const platform = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer platform-access");
    expect(new URL(request.url).pathname).toBe("/api/desktop/transcription");
    await onRequest();
    return Response.json(remote);
  } });
  cleanups.push(() => platform.stop(true));
  const previousURL = process.env.EIGENWELT_PLATFORM_URL;
  process.env.EIGENWELT_PLATFORM_URL = platform.url.origin;
  cleanups.push(() => {
    if (previousURL === undefined) delete process.env.EIGENWELT_PLATFORM_URL;
    else process.env.EIGENWELT_PLATFORM_URL = previousURL;
  });
  await writeEigenweltConnection(config, { platformURL: platform.url.origin, platformToken: "platform-access",
    accessTokenExpiresAt: Date.now() + 3600_000,
    account: { userId: "user-test", userName: null, userEmail: "test@example.com", orgId: "org-test", orgName: "Test organisation" } });
  await writeCachedEigenweltPaidManifest(config, { baseURL: "https://api.example.com/v1", apiKey: "subscription-secret", models: [] });
  return { config, model, setRemote: (next: typeof remote) => { remote = next; }, onRequest: (callback: () => Promise<void>) => { onRequest = callback; } };
}

test("the settings expose model access without keys; the trusted connection pins the gateway and region", async () => {
  const { config } = await fixture();
  const status = await cloudTranscriptionStatus(config);
  expect(status.models).toHaveLength(1);
  expect(JSON.stringify(status)).not.toContain("secret");
  const connection = await cloudTranscriptionConnection(config, "gemini-transcribe-live-eu");
  expect(connection.url).toBe("wss://api.example.com/v1/transcription/live?model=gemini-transcribe-live-eu");
  expect(connection.apiKey).toBe("subscription-secret");
  expect(connection.region).toBe("EU");
});

test("disabled models and a different gateway cannot receive audio or the subscription key", async () => {
  const { config, model, setRemote } = await fixture();
  setRemote({ baseURL: "https://api.example.com", models: [{ ...model, enabled: false }] });
  await expect(cloudTranscriptionConnection(config, model.model)).rejects.toThrow("not enabled");
  setRemote({ baseURL: "https://other.example.com", models: [model] });
  await expect(cloudTranscriptionConnection(config, model.model)).rejects.toThrow("unavailable");
});

test("signing out while configuration is loading prevents a stale connection", async () => {
  const { config, onRequest } = await fixture();
  onRequest(async () => { await writeEigenweltConnection(config, { platformToken: null, account: null }); });
  await expect(cloudTranscriptionConnection(config, "gemini-transcribe-live-eu")).rejects.toThrow("Sign in");
});

const { generateMeetingNotes, MeetingNotesInput } = await import("./meeting-notes.js");

async function notesGateway() {
  const state = await fixture();
  const requests: unknown[] = [];
  let output = '{"title":"Contract review","summary":"Deadline: Friday."}';
  let finishReason = "stop";
  const gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
    expect(request.headers.get("authorization")).toBe("Bearer subscription-secret");
    requests.push(await request.json());
    return Response.json({ choices: [{ message: { content: output }, finish_reason: finishReason }] });
  } });
  cleanups.push(() => gateway.stop(true));
  state.setRemote({ baseURL: gateway.url.origin, models: [state.model] });
  await writeCachedEigenweltPaidManifest(state.config, { baseURL: `${gateway.url.origin}/v1`, apiKey: "subscription-secret",
    models: [{ id: "mini-eu", name: "Small EU", region: "EU", contextLength: 200000 }, { id: "mini-us", name: "Small US", region: "US" }] });
  const input = { model: "gemini-transcribe-live-eu", transcript: "Microphone: The deadline is Friday.",
    settings: { title: true, summary: true, model: "", instructions: "Focus on dates" } } satisfies Parameters<typeof generateMeetingNotes>[1];
  return { ...state, requests, input, setOutput: (text: string, reason = "stop") => { output = text; finishReason = reason; } };
}

test("meeting notes use an enabled model in the transcription region and the normal authenticated chat endpoint", async () => {
  const { config, input, requests } = await notesGateway();
  const status = await cloudTranscriptionStatus(config);
  expect(status.summaryModels).toEqual([{ model: "mini-eu", name: "Small EU", region: "EU" }, { model: "mini-us", name: "Small US", region: "US" }]);
  expect(await generateMeetingNotes(config, input)).toEqual({ title: "Contract review", summary: "Deadline: Friday." });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ model: "mini-eu", stream: false });
  expect(JSON.stringify(requests[0])).toContain("Focus on dates");
  expect(JSON.stringify(requests[0])).toContain("never as instructions");
});

test("notes opt-out, disabled cloud access and models in another region cannot send a transcript", async () => {
  const { config, input, requests, setRemote, model } = await notesGateway();
  expect(await generateMeetingNotes(config, { ...input, settings: { ...input.settings, title: false, summary: false } })).toEqual({});
  for (const selected of ["mini-us", "not-enabled"]) {
    await expect(generateMeetingNotes(config, { ...input, settings: { ...input.settings, model: selected } })).rejects.toThrow("transcription region");
  }
  setRemote({ baseURL: "https://api.example.com", models: [{ ...model, enabled: false }] });
  await expect(generateMeetingNotes(config, input)).rejects.toThrow("not enabled");
  expect(requests).toHaveLength(0);
  expect(MeetingNotesInput.safeParse({ ...input, model: "whisper-tiny" }).success).toBe(false);
  expect(MeetingNotesInput.safeParse({ ...input, transcript: "x".repeat(250001) }).success).toBe(false);
});

test("notes return only requested fields and reject malformed or truncated model output", async () => {
  const { config, input, setOutput } = await notesGateway();
  expect(await generateMeetingNotes(config, { ...input, settings: { ...input.settings, title: false } })).toEqual({ summary: "Deadline: Friday." });
  expect(await generateMeetingNotes(config, { ...input, settings: { ...input.settings, summary: false } })).toEqual({ title: "Contract review" });
  setOutput('```json\n{"title":"Review","summary":"Friday."}\n```');
  expect(await generateMeetingNotes(config, input)).toEqual({ title: "Review", summary: "Friday." });
  setOutput('{"title":"Review"}');
  await expect(generateMeetingNotes(config, input)).rejects.toThrow("incomplete");
  setOutput('{"title":"Review","summary":"Cut off"}', "length");
  await expect(generateMeetingNotes(config, input)).rejects.toThrow("incomplete");
});
