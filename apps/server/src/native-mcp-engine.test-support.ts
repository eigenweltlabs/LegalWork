import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { OpenCode } from "@opencode/client";
import { createManagedOpencodeServer } from "./managed-opencode.js";
import { waitForNativeFixture } from "./native-mcp.test-support.js";

const alias = fileURLToPath(new URL(`../../desktop/resources/sidecars/opencode${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
export const nativeMcpBinary = process.env.LEGALWORK_TEST_OPENCODE_BIN ?? process.env.OPENCODE_TEST_BINARY ?? (existsSync(alias) ? alias : undefined);
if (nativeMcpBinary && !existsSync(nativeMcpBinary)) throw new Error("Configured released OpenCode binary does not exist");

export async function nativeOAuthProvider(environment: Record<string, string> = {}) {
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = listener.port; listener.stop(true);
  if (!port) throw new Error("No fixture port");
  const child = spawn("node", [fileURLToPath(new URL("../../../scripts/mock-oauth-mcp-server.mjs", import.meta.url))], { env: { ...process.env, PORT: String(port), AUTO_APPROVE: "1", ...environment }, stdio: "ignore" });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const url = `http://127.0.0.1:${port}`;
  async function close() { child.kill("SIGTERM"); await Promise.race([exited, Bun.sleep(3000)]); if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
  try {
    await waitForNativeFixture(async () => (await fetch(`${url}/health`)).ok, Boolean, "OAuth fixture provider");
    return { url, requests: async () => { const value: unknown = await (await fetch(`${url}/requests`)).json(); return value; }, close };
  } catch (error) { await close(); throw error; }
}

export async function nativeMcpEngine(configuration: Record<string, unknown> | ((root: string) => Promise<Record<string, unknown>>)) {
  if (!nativeMcpBinary) throw new Error("Released OpenCode binary is required");
  const root = await realpath(await mkdtemp(join(tmpdir(), "legalwork-native-mcp-")));
  for (const name of ["home", "config", "data", "cache", "state", "project", "other"]) await mkdir(join(root, name));
  const directory = join(root, "project"), other = join(root, "other");
  const prepared = typeof configuration === "function" ? await configuration(root) : configuration;
  const options = { bin: nativeMcpBinary, cwd: directory, timeoutMs: 30_000, env: {
    HOME: join(root, "home"), USERPROFILE: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_CONFIG_DIR: join(root, "config"), OPENCODE_DB: join(root, "engine.db"), OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: "disable", warming: false, ...prepared }),
  } };
  let engine = await createManagedOpencodeServer(options);
  const client = () => OpenCode.make({ baseUrl: engine.url, headers: { Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
  return { root, directory, other, location: { directory }, client,
    connection: () => ({ url: engine.url, username: engine.username, password: engine.password }),
    restart: async () => { await engine.close(); engine = await createManagedOpencodeServer(options); },
    close: async () => { await engine.close(); await rm(root, { recursive: true, force: true }); },
  };
}
