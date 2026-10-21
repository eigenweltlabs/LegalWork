import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { CloudTranscriber, pcm16 } from "./audio/cloud-transcriber.mjs";

const until = async condition => {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixture(t, options = {}) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const requests = [];
  server.on("connection", (socket, request) => {
    const state = { socket, request, frames: [], commands: [] };
    requests.push(state);
    socket.on("message", (raw, binary) => {
      if (binary) state.frames.push(Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw));
      else {
        const command = JSON.parse(String(raw));
        state.commands.push(command);
        if (command.type === "finish") {
          socket.send(JSON.stringify({ type: "segment", text: "70.388,50 Euro.", startMs: 0, endMs: 200, id: "s" }));
          socket.send(JSON.stringify({ type: "done" }));
        }
      }
    });
    setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ready" })); }, options.readyDelay ?? 15);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  const worker = new CloudTranscriber({ modelId: "gemini-transcribe-live-eu", language: "de",
    resolveConnection: async () => ({ url: `ws://127.0.0.1:${address.port}/v1/transcription/live?model=gemini-transcribe-live-eu`, apiKey: "fixture-subscription-key" }),
    ...(options.rotateMs ? { rotateMs: options.rotateMs } : {}) });
  const events = [];
  worker.on("message", event => events.push(event));
  t.after(async () => {
    worker.kill();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  worker.postMessage({ type: "begin", streamId: "r", ephemeral: true });
  return { worker, requests, events };
}

test("PCM conversion keeps the sample count and gain; clips non-finite input safely", () => {
  const buffer = pcm16(new Float32Array([-1, -.5, 0, .5, 1, NaN, 2]).buffer);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => buffer.readInt16LE(i * 2)), [-32768, -16384, 0, 16384, 32767, 0, 32767]);
});

test("buffers opening audio and release, sends the tail, and uses the subscription key only in headers", async t => {
  const { worker, requests, events } = await fixture(t, { readyDelay: 40 });
  const samples = new Float32Array(17000).fill(.25);
  worker.postMessage({ type: "pcm", streamId: "r", buffer: samples.buffer });
  worker.postMessage({ type: "finalize", streamId: "r" });
  await until(() => events.some(event => event.type === "finalized"));
  assert.deepEqual(Buffer.concat(requests[0].frames), pcm16(samples.buffer));
  assert.equal(requests[0].request.headers.authorization, "Bearer fixture-subscription-key");
  assert.equal(requests[0].request.url.includes("fixture-subscription-key"), false);
  assert.match(requests[0].request.url, /language=de/);
  assert.deepEqual(requests[0].commands, [{ type: "finish" }]);
  assert.equal(events.find(event => event.type === "segment").text, "70.388,50 Euro.");
});

test("renews a long session without losing or replaying PCM and preserves the recording offset", async t => {
  const { worker, requests, events } = await fixture(t, { rotateMs: 70 });
  worker.postMessage({ type: "pcm", streamId: "r", buffer: new Float32Array(1600).fill(.1).buffer });
  await until(() => requests.length === 2);
  worker.postMessage({ type: "pcm", streamId: "r", buffer: new Float32Array(3200).fill(.2).buffer });
  worker.postMessage({ type: "finalize", streamId: "r" });
  await until(() => events.some(event => event.type === "finalized"));
  assert.equal(requests.flatMap(request => request.frames).reduce((sum, frame) => sum + frame.length, 0), 9600);
  assert.match(requests[1].request.url, /offsetMs=100/);
});

test("an upstream disconnect reports an error without starting a local fallback", async t => {
  const { worker, requests, events } = await fixture(t);
  await until(() => requests.length === 1);
  requests[0].socket.close(1011);
  await until(() => events.some(event => event.type === "stream-error"));
  assert.equal(worker.streams.size, 0);
  assert.equal(requests.length, 1);
});
