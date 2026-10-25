import { randomBytes, randomInt } from "node:crypto";
import type { ApprovalService } from "./approvals.js";
import { ApiError } from "./errors.js";
import type { Actor } from "./types.js";
import { hashToken } from "./utils.js";

const CHALLENGE_TTL_MS = 2 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const SESSION_PREFIX = "office_";

/** Credentials are confined to one server launch and the paired loopback origin. */
export class OfficePairingService {
  private challenges = new Map<string, { origin: string; code: string; expiresAt: number }>();
  private sessions = new Map<string, { origin: string; expiresAt: number }>();
  private pairing = false;
  private disposed = false;

  constructor(private approvals: ApprovalService, private now = Date.now) {}

  private origin(request: Request): string {
    const url = new URL(request.url);
    const authority = request.headers.get("host") ?? url.host;
    // Use the actual Host header: the Node adapter's URL uses its bind address,
    // while Office loads https://localhost and the server may bind 127.0.0.1.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority)) {
      throw new ApiError(403, "office_origin_forbidden", "Office pairing requires a loopback host");
    }
    const origin = new URL(`${url.protocol}//${authority}`).origin;
    const supplied = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if ((supplied !== null && supplied !== origin) || (site && site !== "same-origin" && site !== "none")) {
      throw new ApiError(403, "office_origin_forbidden", "Office pairing requires the add-in's own origin");
    }
    return origin;
  }

  private prune(): void {
    for (const [id, value] of this.challenges) if (value.expiresAt <= this.now()) this.challenges.delete(id);
    for (const [id, value] of this.sessions) if (value.expiresAt <= this.now()) this.sessions.delete(id);
  }

  challenge(request: Request) {
    const origin = this.origin(request);
    this.prune();
    if (this.disposed || this.pairing || this.challenges.size >= 32 || this.sessions.size >= 16) {
      throw new ApiError(429, "office_pairing_busy", "An Office connection is already pending. Try again shortly.");
    }
    const challenge = randomBytes(32).toString("base64url");
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const expiresAt = this.now() + CHALLENGE_TTL_MS;
    this.challenges.set(hashToken(challenge), { origin, code, expiresAt });
    return { challenge, code, expiresAt };
  }

  async pair(request: Request, challenge: string) {
    const origin = this.origin(request);
    this.prune();
    const id = hashToken(challenge);
    const pending = this.challenges.get(id);
    if (!pending || pending.origin !== origin || this.disposed) {
      throw new ApiError(401, "office_pairing_expired", "Office connection expired. Try connecting again.");
    }
    // Consume before awaiting approval: concurrent requests and replays cannot
    // share an approval or retrieve the resulting credential.
    this.challenges.delete(id);
    if (this.pairing) throw new ApiError(429, "office_pairing_busy", "An Office connection is already pending");
    this.pairing = true;
    try {
      const result = await this.approvals.requestApproval({
        workspaceId: "Office add-in",
        action: "office.pair",
        summary: `Connect the Office add-in at ${origin}. Approve only if your Office pane shows code ${pending.code}.`,
        paths: [],
        actor: { type: "remote", clientId: "Office add-in" },
      }, request.signal, true);
      if (!result.allowed || this.disposed || request.signal.aborted || pending.expiresAt <= this.now()) {
        throw new ApiError(403, "office_pairing_denied", "Office connection was not approved. Try connecting again.");
      }
      const token = SESSION_PREFIX + randomBytes(48).toString("base64url");
      const expiresAt = this.now() + SESSION_TTL_MS;
      this.sessions.set(hashToken(token), { origin, expiresAt });
      return { token, expiresAt };
    } finally {
      this.pairing = false;
    }
  }

  actor(request: Request, host = false): Actor | undefined {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token?.startsWith(SESSION_PREFIX)) return undefined;
    this.prune();
    const session = this.sessions.get(hashToken(token));
    if (!session || this.disposed || session.origin !== this.origin(request)) {
      throw new ApiError(401, "office_session_expired", "Reconnect the Office add-in in LegalWork");
    }
    // The pane runs the regular collaborator session UI. Only these additional
    // host operations are needed by its workspace picker and voice controls.
    const path = new URL(request.url).pathname;
    if (host && !(request.method === "POST" && (
      path === "/workspaces/pick-folder" || path === "/workspaces/local" ||
      /^\/workspaces\/[^/]+\/activate$/.test(path) || path === "/voice/realtime/call"
    )) && !(request.method === "GET" && path === "/voice/realtime/capability")) {
      throw new ApiError(403, "office_scope_forbidden", "This operation requires the LegalWork desktop owner");
    }
    return { type: "remote", clientId: "Office add-in", scope: "collaborator", tokenHash: hashToken(token) };
  }

  revoke(request: Request): void {
    this.actor(request);
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token?.startsWith(SESSION_PREFIX)) throw new ApiError(401, "unauthorized", "Office credential required");
    this.sessions.delete(hashToken(token));
  }

  dispose(): void {
    this.disposed = true;
    this.sessions.clear();
    this.challenges.clear();
  }
}
