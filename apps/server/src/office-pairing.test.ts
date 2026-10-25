import { describe, expect, test } from "bun:test";
import { ApprovalService } from "./approvals.js";
import { OfficePairingService } from "./office-pairing.js";

function request(path = "/word-addin/pair", token?: string, origin = "http://localhost:8787") {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { Host: new URL(origin).host, Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}
function service(reply: "allow" | "deny" = "allow", now?: () => number) {
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => reply);
  return new OfficePairingService(approvals, now);
}

describe("Office pairing authority", () => {
  test("requires host confirmation even when ordinary workspace approvals are automatic", async () => {
    const pairing = service("deny");
    const challenge = pairing.challenge(request());
    await expect(pairing.pair(request(), challenge.challenge)).rejects.toMatchObject({ status: 403 });
    await expect(pairing.pair(request(), challenge.challenge)).rejects.toMatchObject({ status: 401 });
  });

  test("consumes challenges once and issues only a temporary collaborator credential", async () => {
    const pairing = service();
    const challenge = pairing.challenge(request());
    const session = await pairing.pair(request(), challenge.challenge);
    expect(session.token).toStartWith("office_");
    expect(pairing.actor(request("/whoami", session.token))).toMatchObject({ scope: "collaborator", clientId: "Office add-in" });
    await expect(pairing.pair(request(), challenge.challenge)).rejects.toMatchObject({ status: 401 });
    expect(() => pairing.actor(request("/tokens", session.token), true)).toThrow();
    expect(pairing.actor(request("/workspaces/pick-folder", session.token), true)).toMatchObject({ scope: "collaborator" });
    pairing.revoke(request("/word-addin/session", session.token));
    expect(() => pairing.actor(request("/whoami", session.token))).toThrow();
  });

  test("rejects cross-origin requests, rebinding hosts and non-loopback authorities", () => {
    const pairing = service();
    const untrusted: HeadersInit[] = [
      { Host: "localhost:8787", Origin: "https://evil.example" },
      { Host: "evil.example", Origin: "http://evil.example" },
      { Host: "127.0.0.1:8787", Origin: "null" },
      { Host: "localhost:8787", "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of untrusted) {
      expect(() => pairing.challenge(new Request("http://127.0.0.1:8787/word-addin/pair", { headers }))).toThrow();
    }
  });

  test("binds a credential to its paired origin, expires it and discards it on shutdown", async () => {
    let now = 1000;
    const pairing = service("allow", () => now);
    const expired = pairing.challenge(request());
    now = expired.expiresAt;
    await expect(pairing.pair(request(), expired.challenge)).rejects.toMatchObject({ status: 401 });
    const challenge = pairing.challenge(request());
    const session = await pairing.pair(request(), challenge.challenge);
    expect(() => pairing.actor(request("/whoami", session.token, "http://localhost:9999"))).toThrow();
    now = session.expiresAt;
    expect(() => pairing.actor(request("/whoami", session.token))).toThrow();
    const next = pairing.challenge(request());
    const active = await pairing.pair(request(), next.challenge);
    pairing.dispose();
    expect(() => pairing.actor(request("/whoami", active.token))).toThrow();
  });

  test("permits only one pending confirmation, and aborting it never issues a credential", async () => {
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 });
    const pairing = new OfficePairingService(approvals);
    const challenge = pairing.challenge(request());
    const controller = new AbortController();
    const pending = pairing.pair(new Request(request(), { signal: controller.signal }), challenge.challenge);
    expect(approvals.list()).toHaveLength(1);
    expect(() => pairing.challenge(request())).toThrow();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(approvals.list()).toHaveLength(0);
    expect(pairing.challenge(request()).challenge).toBeString();
    pairing.dispose();
    approvals.dispose();
  });
});
