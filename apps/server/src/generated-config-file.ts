import { randomUUID } from "node:crypto";
import { readFile, rename, rm, utimes, writeFile } from "node:fs/promises";

/** Native config watchers reload plugins on publication, even for identical bytes. */
export async function writeGeneratedConfigFile(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, "utf8") === content) return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    // Notify watchers about the published file itself. Rename-only publication
    // can leave native locations with stale config after an atomic replacement.
    const now = new Date();
    await utimes(path, now, now);
  } finally {
    await rm(temporary, { force: true });
  }
}
