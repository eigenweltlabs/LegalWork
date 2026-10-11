import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxFilesystem } from "../agent-sandbox/filesystem.js";
import { assertWikiFileToolAccess, assertWikiHostExecution, buildWikiFilePolicy, wikiSafeSandboxMounts } from "./file-access-policy.js";

let root: string, project: string, own: string, external: string, runtime: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "wiki-file-policy-")));
  project = join(root, "project"); runtime = join(root, "runtime");
  own = join(runtime, "wikis", "personal"); external = join(root, "shared");
  await Promise.all([project, own, external].map(path => mkdir(path, { recursive: true })));
  await writeFile(join(external, "Existing.md"), "original");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const policy = (directory = project) => buildWikiFilePolicy([{ root: own }, { root: external }], directory, [runtime]);

describe("Wiki filesystem boundaries", () => {
  test("ordinary project files remain editable but all external wiki writes use approved wiki tools", async () => {
    const rules = await policy();
    for (const tool of ["write", "edit", "multiedit"]) {
      await assertWikiFileToolAccess(rules, tool, { filePath: "Draft.md" });
      for (const filePath of [join(own, "New.md"), join(external, "Existing.md"), "../shared/Existing.md", root])
        await expect(assertWikiFileToolAccess(rules, tool, { filePath })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    }
  });
  test("patches validate additions, edits, removals and move destinations before any part executes", async () => {
    const rules = await policy();
    await assertWikiFileToolAccess(rules, "apply_patch", { patchText: "*** Begin Patch\n*** Add File: Draft.md\n+draft\n*** End Patch" });
    for (const header of ["Add File", "Update File", "Delete File", "Move to"]) {
      const patchText = `*** Begin Patch\n*** Update File: Draft.md\n@@\n-old\n+new\n*** ${header}: ${external}/New.md\n*** End Patch`;
      await expect(assertWikiFileToolAccess(rules, "apply_patch", { patchText })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    }
    await expect(assertWikiFileToolAccess(rules, "apply_patch", { patchText: "unrecognized patch" })).rejects.toMatchObject({ code: "wiki_patch_arguments_invalid" });
    await expect(assertWikiFileToolAccess(rules, "batch", { tool_calls: [{ tool: "write", parameters: { filePath: `${external}/New.md` } }] })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    const mixedNewlines = `*** Begin Patch\n*** Add File: Draft.md\n+safe\r*** Add File: ${external}/New.md\r+unsafe\n*** End Patch`;
    await expect(assertWikiFileToolAccess(rules, "apply_patch", { patchText: mixedNewlines })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
  });
  test("ambiguous paths and executable engine configuration cannot bypass file permissions", async () => {
    const rules = await policy();
    for (const filePath of ["~/shared/New.md", "file:///tmp/New.md", "Draft.md\rOther.md"])
      await expect(assertWikiFileToolAccess(rules, "write", { filePath })).rejects.toMatchObject({ code: "wiki_file_arguments_invalid" });
    for (const filePath of [".opencode/plugins/bypass.ts", "opencode.json", "opencode.jsonc", "../.config/opencode/plugins/bypass.ts"])
      await expect(assertWikiFileToolAccess(rules, "write", { filePath })).rejects.toMatchObject({ code: "wiki_engine_config_write_denied" });
    await mkdir(join(project, ".opencode"));
    await symlink(join(project, ".opencode"), join(project, "engine-alias"));
    await expect(assertWikiFileToolAccess(rules, "write", { filePath: "engine-alias/plugins/bypass.ts" })).rejects.toMatchObject({ code: "wiki_engine_config_write_denied" });
    await assertWikiFileToolAccess(rules, "write", { filePath: "src/parser.ts" });
  });
  test("canonicalization catches symlink parents, new descendants and aliased registered roots", async () => {
    const alias = join(project, "alias");
    await symlink(external, alias);
    const rules = await buildWikiFilePolicy([{ root: alias }], project);
    expect(rules.protectedRoots).toEqual([external]);
    await expect(assertWikiFileToolAccess(rules, "write", { filePath: "alias/new/subfolder/Page.md" })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    await expect(assertWikiFileToolAccess(rules, "edit", { filePath: "alias/Existing.md" })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
    await link(join(external, "Existing.md"), join(project, "linked.md"));
    await expect(assertWikiFileToolAccess(rules, "edit", { filePath: "linked.md" })).rejects.toMatchObject({ code: "wiki_linked_file_write_denied" });
  });
  test("own-wiki content is writable while other wikis remain protected", async () => {
    const rules = await policy(own);
    expect(rules.ownRoot).toBe(own);
    await assertWikiFileToolAccess(rules, "write", { filePath: "Client.md" });
    await expect(assertWikiFileToolAccess(rules, "write", { filePath: `${external}/Client.md` })).rejects.toMatchObject({ code: "wiki_direct_write_denied" });
  });
  test("cross-wiki reads use permission-checked wiki tools and runtime credentials stay private", async () => {
    const rules = await policy();
    for (const path of [own, external]) {
      await expect(assertWikiFileToolAccess(rules, "read", { filePath: join(path, "Client.md") })).rejects.toMatchObject({ code: "wiki_direct_read_denied" });
      await expect(assertWikiFileToolAccess(rules, "grep", { path, pattern: "client" })).rejects.toMatchObject({ code: "wiki_direct_read_denied" });
    }
    await assertWikiFileToolAccess(await policy(own), "read", { filePath: "Client.md" });
    await assertWikiFileToolAccess(rules, "grep", { pattern: "client" });
    await expect(assertWikiFileToolAccess(rules, "write", { filePath: join(runtime, "wikis.md") })).rejects.toMatchObject({ code: "wiki_policy_write_denied" });
    await expect(assertWikiFileToolAccess(rules, "read", { filePath: join(runtime, "tokens.json") })).rejects.toMatchObject({ code: "wiki_runtime_read_denied" });
    await expect(assertWikiFileToolAccess(rules, "grep", { path: root, pattern: "token" })).rejects.toMatchObject({ code: "wiki_direct_read_denied" });
  });
  test("a read-only own wiki cannot be written through file tools or host shell", async () => {
    const rules = { ...await policy(own), ownWritable: false };
    await assertWikiFileToolAccess(rules, "read", { filePath: "Client.md" });
    await expect(assertWikiFileToolAccess(rules, "edit", { filePath: "Client.md" })).rejects.toMatchObject({ code: "wiki_read_only" });
    expect(() => assertWikiHostExecution(rules)).toThrow("read-only");
  });
  test("unprotected shell has no command-text or declared-write bypass", async () => {
    const rules = await policy();
    expect(() => assertWikiHostExecution(rules)).toThrow("Enable sandboxing");
    for (const command of ["echo hello", "python3 script.py", "bash -lc true"])
      await expect(assertWikiFileToolAccess(rules, "bash", { command, write: false })).rejects.toMatchObject({ code: "wiki_protected_execution_required" });
    expect(() => assertWikiHostExecution({ ...rules, protectedRoots: [] })).not.toThrow();
  });
  test("external wiki mounts become read-only and writable ancestor mounts fail closed", async () => {
    const rules = await policy();
    const alias = join(root, "alias"); await symlink(external, alias);
    const mounts = await wikiSafeSandboxMounts(rules, [{ source: project, target: "/workspace", writable: true }, { source: alias, target: "/authorized/0", writable: true }]);
    expect(mounts[0].writable).toBe(true);
    expect(mounts[1]).toEqual({ source: external, target: "/authorized/0", writable: false });
    await expect(wikiSafeSandboxMounts(rules, [{ source: root, target: "/workspace", writable: true }])).rejects.toMatchObject({ code: "wiki_sandbox_mount_denied" });
    const fs = await SandboxFilesystem.create(mounts, new AbortController().signal);
    try {
      await expect(fs.request({ op: "open", path: "/authorized/0/Existing.md", write: true, create: false, exclusive: false, truncate: true })).rejects.toMatchObject({ code: "EROFS" });
      await expect(fs.request({ op: "unlink", path: "/authorized/0/Existing.md" })).rejects.toMatchObject({ code: "EROFS" });
      await expect(fs.request({ op: "rename", path: "/authorized/0/Existing.md", destination: "/workspace/Move.md" })).rejects.toMatchObject({ code: "EROFS" });
      const handle = await fs.request({ op: "open", path: "/authorized/0/Existing.md", write: false, create: false, exclusive: false, truncate: false });
      expect(typeof handle).toBe("number");
    } finally { await fs.dispose(); }
  });
});
