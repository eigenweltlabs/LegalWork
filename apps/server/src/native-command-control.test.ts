import { expect, test } from "bun:test";
import { OpenCode } from "@opencode/client";
import { assertManagedCommandIntegration, interruptEngineSession } from "./native-command-control.js";
import { ApiError } from "./errors.js";

test("Stop cancels command expansion in the saved location and still interrupts the engine when cancellation fails", async () => {
  let mode: "command" | "standalone" | "broken" | "permission" = "command";
  let interrupted = 0;
  const client = OpenCode.make({ baseUrl: "http://command-control.invalid", fetch: Object.assign(async (request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    if (url.pathname === "/api/session/chat") return Response.json({ data: { id: "chat", location: { directory: "/saved/project" } } });
    if (url.pathname === "/api/session/chat/interrupt") { interrupted++; return Response.json({ interrupted: false }); }
    expect(url.pathname).toBe("/api/rpc/legalwork.commands/cancel");
    expect(url.searchParams.get("location[directory]")).toBe("/saved/project");
    expect(JSON.parse(String(init?.body))).toEqual({ input: { sessionID: "chat" } });
    if (mode === "command") return Response.json({ output: { cancelled: true } });
    const detail = mode === "permission" ? { _tag: "ForbiddenError", message: "Forbidden" }
      : { _tag: "RpcError", type: mode === "standalone" ? "rpc.unavailable" : "command.broken", message: "Command integration unavailable" };
    // The LegalWork transport preserves structured upstream errors in ApiError.
    throw new ApiError(502, "opencode_request_failed", "The agent engine rejected the request.", { status: 500, detail });
  }, { preconnect: fetch.preconnect }) });
  expect(await interruptEngineSession(client, "chat", { managedCommands: true })).toEqual({ interrupted: true });
  mode = "standalone";
  expect(await interruptEngineSession(client, "chat", { managedCommands: false })).toEqual({ interrupted: false });
  await expect(interruptEngineSession(client, "chat", { managedCommands: true })).rejects.toThrow();
  mode = "broken";
  await expect(interruptEngineSession(client, "chat", { managedCommands: false })).rejects.toThrow();
  mode = "permission";
  await expect(interruptEngineSession(client, "chat", { managedCommands: false })).rejects.toThrow();
  expect(interrupted).toBe(5);
});

test("shortcut admission requires the active sandbox adapter and rejects the native unsafe loader", async () => {
  let mode: "ready" | "missing" | "failed" | "unsafe" = "ready";
  const client = OpenCode.make({ baseUrl: "http://command-control.invalid", fetch: Object.assign(async (request: Parameters<typeof fetch>[0]) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    expect(url.pathname).toBe("/api/plugin");
    expect(url.searchParams.get("location[directory]")).toBe("/matter");
    return Response.json({ location: { directory: "/matter" }, data: mode === "missing" ? [] : [
      { id: "legalwork.commands", state: mode === "failed" ? { status: "failed", error: "Fixture startup failed" } : { status: "active" } },
      ...(mode === "unsafe" ? [{ id: "opencode.config.command", state: { status: "active" } }] : []),
    ] });
  }, { preconnect: fetch.preconnect }) });
  await expect(assertManagedCommandIntegration(client, { directory: "/matter" })).resolves.toBeUndefined();
  for (const value of ["missing", "failed", "unsafe"] satisfies Array<"missing" | "failed" | "unsafe">) {
    mode = value;
    await expect(assertManagedCommandIntegration(client, { directory: "/matter" })).rejects.toMatchObject({ code: "managed_commands_unavailable" });
  }
});
