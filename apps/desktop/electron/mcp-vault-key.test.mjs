import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMcpVaultKeyProvider } from "./mcp-vault-key.mjs";

function secureStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString(value) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(value) {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString();
    },
  };
}

test("connector keys persist only as OS-protected blobs and are reused after restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "legalwork-mcp-key-"));
  try {
    const storage = secureStorage();
    const first = createMcpVaultKeyProvider(dir, storage);
    const [a, b] = await Promise.all([first(), first()]);
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);
    assert.deepEqual(await createMcpVaultKeyProvider(dir, storage)(), a);
    const file = await readFile(path.join(dir, "managed-mcp-key.enc"));
    assert.equal(file.includes(a), false);
    assert.equal(file.includes(Buffer.from(a.toString("base64"))), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("locked storage can recover; Linux plaintext storage is rejected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "legalwork-mcp-key-"));
  try {
    let unlocked = false;
    const storage = { ...secureStorage(), isEncryptionAvailable: () => unlocked };
    const key = createMcpVaultKeyProvider(dir, storage);
    await assert.rejects(key(), /secure storage/);
    unlocked = true;
    assert.equal((await key()).length, 32);
    await assert.rejects(createMcpVaultKeyProvider(dir, { ...storage, getSelectedStorageBackend: () => "basic_text" }, "linux")(), /secure storage/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
