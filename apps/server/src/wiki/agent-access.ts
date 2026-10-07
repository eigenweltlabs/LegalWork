import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { Actor, ServerConfig, TokenScope } from "../types.js";
import { ApiError } from "../errors.js";

type SessionOrigin = { directory: string; scope: TokenScope };
type RuntimeAccess = { token: string; sessions: Map<string, SessionOrigin> };
const runtimes = new WeakMap<ServerConfig, RuntimeAccess>();

function runtime(config: ServerConfig): RuntimeAccess {
  let access = runtimes.get(config);
  if (!access) {
    access = { token: randomBytes(32).toString("hex"), sessions: new Map() };
    runtimes.set(config, access);
  }
  return access;
}

/** Only the managed engine receives this ephemeral, narrow credential. */
export async function ensureWikiAgentToken(config: ServerConfig): Promise<string> {
  return runtime(config).token;
}

/** Called by the authenticated proxy, never from request-body identity claims. */
export async function grantWikiAgentSession(config: ServerConfig, input: {
  sessionId: string;
  directory: string;
  scope: TokenScope;
}): Promise<void> {
  if (!input.sessionId || input.sessionId.length > 200) throw new ApiError(403, "wiki_agent_session_invalid", "The agent session is unknown.");
  const directory = await realpath(input.directory).catch(() => null);
  if (!directory) {
    // A remote engine may use a directory absent on this host. Its ordinary
    // session can proceed, but no private wiki grant may survive that change.
    runtimes.get(config)?.sessions.delete(input.sessionId);
    return;
  }
  const access = runtime(config);
  const previous = access.sessions.get(input.sessionId);
  if (previous && previous.directory !== directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "This agent session belongs to another working directory.");
  // Replace rather than merge: a collaborator taking over an owner's session
  // must immediately lose the owner's private wiki access.
  access.sessions.set(input.sessionId, { directory, scope: input.scope });
}

function narrowWikiPath(method: string, pathname: string): boolean {
  if (method === "GET" && (pathname === "/workspaces" || pathname === "/wikis")) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/search$/.test(pathname)) return true;
  return ["GET", "PUT", "DELETE"].includes(method) && /^\/wikis\/[^/]+\/page$/.test(pathname);
}

/**
 * This is not a host/owner credential. A valid runtime secret authenticates
 * only a session whose origin the server recorded from an authenticated user.
 * Wiki routes still enforce that actor's visibility and this directory's scope.
 */
export async function authenticateWikiAgentRequest(config: ServerConfig, request: Request): Promise<{
  actor: Actor;
  directory: string;
} | null> {
  const token = request.headers.get("x-legalwork-wiki-agent-token");
  if (token === null) return null;
  const access = runtimes.get(config);
  const candidate = Buffer.from(token);
  const expected = Buffer.from(access?.token ?? "");
  if (!access || candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
    throw new ApiError(403, "wiki_agent_unauthorized", "The wiki agent connection is not authorized.");
  if (!narrowWikiPath(request.method, new URL(request.url).pathname))
    throw new ApiError(403, "wiki_agent_endpoint_denied", "This agent credential is limited to wiki page tools.");
  const sessionId = request.headers.get("x-legalwork-wiki-agent-session");
  const origin = sessionId ? access.sessions.get(sessionId) : undefined;
  if (!origin) throw new ApiError(403, "wiki_agent_session_unknown", "Run this task through an authenticated LegalWork session before accessing wikis.");
  const claimed = request.headers.get("x-legalwork-wiki-agent-directory");
  let decoded: string | null = null;
  try { decoded = claimed ? decodeURIComponent(claimed) : null; } catch { /* Invalid encoded claims fail closed. */ }
  const directory = decoded ? await realpath(decoded).catch(() => null) : null;
  if (!directory || directory !== origin.directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "The wiki request does not match this session's working directory.");
  return { directory, actor: { type: "remote", clientId: `wiki-agent:${sessionId}`, scope: origin.scope,
    tokenHash: createHash("sha256").update(access.token).digest("hex") } };
}
