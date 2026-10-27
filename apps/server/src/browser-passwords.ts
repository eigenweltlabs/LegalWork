import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { OAuthVault, oauthVaultPath, vaultLock } from "./file-storage/oauth/vault.js";
import type { ServerConfig } from "./types.js";

const entry = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(200),
  origin: z.string(), username: z.string().max(500),
  password: z.string().min(1).max(10000), updatedAt: z.string(),
});
const entries = z.array(entry);
const input = entry.pick({ label: true, username: true }).extend({
  id: z.string().uuid().optional(), origin: z.string().min(1).max(2000),
  password: z.string().max(10000).optional(),
});
const key = JSON.stringify(["browser-passwords", 1]);
type Entry = z.infer<typeof entry>;
function summary(value: Entry) {
  return { id: value.id, label: value.label, origin: value.origin, username: value.username, updatedAt: value.updatedAt };
}

export function browserPasswordOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, "invalid_password_origin", "Enter a complete HTTPS website address."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new ApiError(400, "invalid_password_origin", "Use HTTPS for browser passwords (HTTP is supported only on localhost).");
  }
  return url.origin;
}

/** A separate namespace in the existing vault; never exported as environment variables. */
export class BrowserPasswordStore {
  constructor(readonly vault: OAuthVault) {}
  private async read() { return await this.vault.getEntry(key, entries) ?? []; }
  async list(origin?: string) {
    return (await this.read()).filter(value => !origin || value.origin === origin).map(summary);
  }
  async get(id: string) {
    const value = (await this.read()).find(value => value.id === id);
    if (!value) throw new ApiError(404, "browser_password_not_found", "The saved browser password no longer exists.");
    return value;
  }
  async save(raw: unknown) {
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "invalid_browser_password", "Enter a label, website and password of at most 10,000 characters.");
    const value = parsed.data, origin = browserPasswordOrigin(value.origin);
    return vaultLock(`${this.vault.path}:${key}`, async () => {
      const current = await this.read(), previous = current.find(item => item.id === value.id);
      if (value.id && !previous) throw new ApiError(404, "browser_password_not_found", "The saved browser password no longer exists.");
      const password = value.password || (previous?.origin === origin ? previous.password : undefined);
      if (!password) throw new ApiError(400, "browser_password_required", "Enter a password when adding an entry or changing its website.");
      const next = entry.parse({ ...value, origin, password, id: previous?.id ?? randomUUID(), updatedAt: new Date().toISOString() });
      await this.vault.setEntry(key, entries, [...current.filter(item => item.id !== next.id), next]);
      return summary(next);
    });
  }
  async delete(id: string) {
    return vaultLock(`${this.vault.path}:${key}`, async () => {
      const current = await this.read();
      if (!current.some(value => value.id === id)) throw new ApiError(404, "browser_password_not_found", "The saved browser password no longer exists.");
      await this.vault.setEntry(key, entries, current.filter(value => value.id !== id));
    });
  }
}

export function browserPasswords(config: Pick<ServerConfig, "configPath">) {
  return new BrowserPasswordStore(new OAuthVault(oauthVaultPath(config)));
}
