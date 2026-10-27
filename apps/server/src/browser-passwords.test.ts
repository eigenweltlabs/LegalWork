import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BrowserPasswordStore, browserPasswordOrigin } from "./browser-passwords.js";
import { OAuthVault } from "./file-storage/oauth/vault.js";

test("browser passwords share the encrypted vault without replacing OAuth entries, exposing values or losing concurrent edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-passwords-"));
  try {
    const vault = new OAuthVault(join(root, "test.vault")), store = new BrowserPasswordStore(vault);
    await vault.set("existing-oauth", { accessToken: "access", refreshToken: "refresh", expiresAt: 999 });
    const first = await store.save({ label: "Research", origin: "https://login.example.org/path", username: "lawyer", password: "fixture-secret-123" });
    expect(first.origin).toBe("https://login.example.org");
    expect(JSON.stringify(first)).not.toContain("fixture-secret-123");
    expect(JSON.stringify(await store.list())).not.toContain("password");
    expect((await readFile(vault.path)).includes(Buffer.from("fixture-secret-123"))).toBe(false);
    await Promise.all([
      store.save({ ...first, label: "Renamed", password: "" }),
      store.save({ label: "Other account", origin: first.origin, username: "other", password: "other-secret" }),
      vault.setEntry("other-consumer", z.object({ token: z.string() }), { token: "connector-token" }),
    ]);
    expect(await store.list(first.origin)).toHaveLength(2);
    expect(await store.list("https://example.org")).toEqual([]);
    expect((await store.get(first.id)).password).toBe("fixture-secret-123");
    expect((await store.get(first.id)).label).toBe("Renamed");
    expect(await vault.get("existing-oauth")).toEqual({ accessToken: "access", refreshToken: "refresh", expiresAt: 999 });
    expect(await vault.getEntry("other-consumer", z.object({ token: z.string() }))).toEqual({ token: "connector-token" });
    await expect(store.save({ ...first, origin: "https://other.example.org", password: "" })).rejects.toThrow("Enter a password");
    await store.save({ ...first, password: "replacement" });
    expect((await new BrowserPasswordStore(new OAuthVault(vault.path)).get(first.id)).password).toBe("replacement");
    await store.delete(first.id);
    await expect(store.get(first.id)).rejects.toThrow("no longer exists");
    expect(await store.list()).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("website binding rejects unsafe URLs and treats ports, schemes and subdomains exactly", () => {
  for (const url of ["file:///tmp/password", "javascript:alert(1)", "http://example.org", "example.org"]) {
    expect(() => browserPasswordOrigin(url)).toThrow();
  }
  const authenticated = new URL("https://example.org");
  authenticated.username = "fixture-user";
  authenticated.password = "fixture-only-password";
  expect(() => browserPasswordOrigin(authenticated.href)).toThrow();
  expect(browserPasswordOrigin("https://LOGIN.Example.org:443/path?q=1")).toBe("https://login.example.org");
  expect(browserPasswordOrigin("http://127.0.0.1:8123/login")).toBe("http://127.0.0.1:8123");
});
