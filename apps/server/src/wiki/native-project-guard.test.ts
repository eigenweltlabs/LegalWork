import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWikiNativeFileAccess } from "./native-project-guard.js";

test("wiki native file tools stay inside wiki even with symlinks or multi-file edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-native-guard-"));
  try {
    const wiki = join(root, "wiki"), project = join(root, "project");
    await mkdir(wiki); await mkdir(project); await writeFile(join(project, "secret.txt"), "private");
    await symlink(project, join(wiki, "alias"));
    for (const tool of ["read", "write", "edit", "grep", "glob", "list"])
      for (const path of [join(project, "secret.txt"), "../project/secret.txt", "alias/secret.txt", "alias/new.txt"])
        await expect(assertWikiNativeFileAccess(wiki, tool, { path })).rejects.toMatchObject({ code: "wiki_native_project_access" });
    for (const pattern of ["../project/*", join(project, "*")]) await expect(assertWikiNativeFileAccess(wiki, "glob", { pattern })).rejects.toThrow();
    for (const tool of ["patch", "apply_patch", "multiedit"]) await expect(assertWikiNativeFileAccess(wiki, tool, {})).rejects.toThrow();
    await expect(assertWikiNativeFileAccess(wiki, "write", { filePath: "new.md" })).resolves.toBeUndefined();
    await expect(assertWikiNativeFileAccess(wiki, "glob", {})).resolves.toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
