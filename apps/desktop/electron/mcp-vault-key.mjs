import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Persist only an OS-protected key blob, separate from the connector vault. */
export function createMcpVaultKeyProvider(directory, secureStorage, platform = process.platform) {
  let pending;
  return () => {
    pending ??= (async () => {
      if (!secureStorage.isEncryptionAvailable() || (platform === "linux" && secureStorage.getSelectedStorageBackend() === "basic_text")) {
        throw new Error("Unlock the operating system's secure storage to use connected apps.");
      }
      const file = path.join(directory, "managed-mcp-key.enc");
      await mkdir(directory, { recursive: true });
      let protectedKey;
      try { protectedKey = await readFile(file); }
      catch (error) {
        if (error?.code !== "ENOENT") throw error;
        protectedKey = secureStorage.encryptString(randomBytes(32).toString("base64"));
        try { await writeFile(file, protectedKey, { flag: "wx", mode: 0o600 }); }
        catch (error) { if (error?.code !== "EEXIST") throw error; protectedKey = await readFile(file); }
      }
      const key = Buffer.from(secureStorage.decryptString(protectedKey), "base64");
      if (key.length !== 32) throw new Error("The connector encryption key could not be opened.");
      return key;
    })();
    return pending.catch(error => { pending = undefined; throw error; });
  };
}
