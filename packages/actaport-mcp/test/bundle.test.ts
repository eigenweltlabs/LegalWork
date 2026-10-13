import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("bundled Node stdio server discovers all tools and enforces live write revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "actaport-bundle-"));
  let allowWrites = true;
  const secret = "test-bridge-capability-with-at-least-32-characters";
  const bridge = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) return new Response(null, { status: 401 });
    return Response.json({ accessToken: "private-test-token", expiresAt: Date.now() + 300_000, allowWrites });
  } });
  const descriptor = join(root, "connection.json");
  await writeFile(descriptor, JSON.stringify({ baseUrl: `http://127.0.0.1:${bridge.port}/`, token: secret }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: "node", args: [fileURLToPath(new URL("../dist/index.mjs", import.meta.url))],
    env: { ACTAPORT_CONNECTION_FILE: descriptor }, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: "bundle-smoke", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(92);
    expect(tools.tools.find((item) => item.name === "actaport_create_kontakt")?.annotations?.readOnlyHint).toBe(false);
    allowWrites = false;
    // Revoked writes must fail before reaching the actual Actaport API; no external request is made.
    const result = await client.callTool({ name: "actaport_create_kostenstelle", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("read_only");
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(stderr).not.toContain("private-test-token");
  } finally { await client.close(); bridge.stop(true); await rm(root, { recursive: true, force: true }); }
});
