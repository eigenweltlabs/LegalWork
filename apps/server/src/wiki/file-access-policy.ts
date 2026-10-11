import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { SandboxMount } from "../agent-sandbox/files.js";
import { canonicalFolderPath } from "./workspace-safety.js";

export const wikiFilePolicySchema = z.object({
  directory: z.string().min(1),
  ownRoot: z.string().min(1).nullable(),
  ownWritable: z.boolean(),
  protectedRoots: z.array(z.string().min(1)),
  runtimeRoots: z.array(z.string().min(1)),
}).strict();
export type WikiFilePolicy = z.infer<typeof wikiFilePolicySchema>;

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}
const overlaps = (left: string, right: string) => within(left, right) || within(right, left);
const denied = () => new ApiError(403, "wiki_direct_write_denied", "Changes to another wiki must use wiki tools and receive user approval. Ordinary file tools cannot write there.");

function checkedToolPath(path: string): string {
  // Tool implementations do not all expand these forms identically. Never
  // approve one destination while the underlying tool could resolve another.
  if (!path || /[\x00-\x1f\x7f]/.test(path) || path.startsWith("~") || !isAbsolute(path) && /^[a-z][a-z\d+.-]*:/i.test(path))
    throw new ApiError(400, "wiki_file_arguments_invalid", "Use an absolute file path or a path relative to this workspace.");
  return path;
}

function engineConfigPath(path: string): boolean {
  const parts = path.toLowerCase().split(sep);
  return parts.some((part, index) => part === ".opencode" || part === "opencode.json" || part === "opencode.jsonc" ||
    part === "opencode" && parts[index - 1] === ".config");
}

/** Includes every registered wiki, even private or project-disabled wikis. */
export async function buildWikiFilePolicy(wikis: ReadonlyArray<{ root: string }>, directory: string, runtimeRoots: string[] = []): Promise<WikiFilePolicy> {
  const canonicalDirectory = await realpath(directory);
  const roots = [...new Set(await Promise.all(wikis.map(wiki => canonicalFolderPath(wiki.root))))];
  const ownRoot = roots.filter(root => within(root, canonicalDirectory)).sort((a, b) => b.length - a.length)[0] ?? null;
  const protectedRoots = roots.filter(root => root !== ownRoot);
  const engineConfigRoot = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
  return { directory: canonicalDirectory, ownRoot, ownWritable: true, protectedRoots,
    runtimeRoots: [...new Set(await Promise.all([...runtimeRoots, ...(protectedRoots.length ? [engineConfigRoot] : [])].map(canonicalFolderPath)))] };
}

/** A host process can write any wiki regardless of its declared write flag. */
export function assertWikiHostExecution(policy: WikiFilePolicy): void {
  if (policy.ownRoot && !policy.ownWritable) throw new ApiError(403, "wiki_read_only", "This chat has read-only access to its wiki. Enable sandboxing for commands with read-only file access.");
  if (policy.protectedRoots.length) throw new ApiError(403, "wiki_protected_execution_required", "This chat has external wikis that require approved wiki-tool writes. Enable sandboxing for shell commands; unprotected host execution cannot enforce those boundaries.");
}

export function wikiFileToolNeedsPolicy(tool: string): boolean {
  return ["read", "grep", "glob", "list", "write", "edit", "multiedit", "apply_patch", "patch", "batch", "bash", "shell"].includes(tool);
}

export function wikiContentPath(policy: WikiFilePolicy, path: string): boolean {
  return [...policy.protectedRoots, ...(policy.ownRoot ? [policy.ownRoot] : [])].some(root => within(root, path));
}

function mutationPaths(tool: string, input: unknown): string[] {
  const args = z.record(z.string(), z.unknown()).safeParse(input);
  if (!args.success) throw new ApiError(400, "wiki_file_arguments_invalid", "The file operation could not be checked against wiki permissions.");
  if (["write", "edit", "multiedit"].includes(tool)) {
    const path = args.data.filePath;
    if (typeof path !== "string" || !path || path.includes("\0")) throw new ApiError(400, "wiki_file_arguments_invalid", "Provide a valid filePath so wiki permissions can be checked.");
    return [checkedToolPath(path)];
  }
  const patch = args.data.patchText;
  if (typeof patch !== "string" || !patch.trimStart().startsWith("*** Begin Patch") || !patch.trimEnd().endsWith("*** End Patch"))
    throw new ApiError(400, "wiki_patch_arguments_invalid", "Use the supported apply_patch format so every changed path can be checked against wiki permissions.");
  const paths: string[] = [];
  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line.trimStart());
    if (match) {
      if (!match[1].trim() || match[1].includes("\0")) throw new ApiError(400, "wiki_patch_arguments_invalid", "Invalid patch path.");
      paths.push(checkedToolPath(match[1].trim()));
    }
  }
  if (!paths.length) throw new ApiError(400, "wiki_patch_arguments_invalid", "The patch does not identify its changed paths.");
  return paths;
}

/** Checks real destinations, including symlinked parents and new descendant files. */
export async function assertWikiFileToolAccess(policy: WikiFilePolicy, tool: string, args: unknown): Promise<void> {
  if (!wikiFileToolNeedsPolicy(tool)) return;
  if (["bash", "shell"].includes(tool)) { assertWikiHostExecution(policy); return; }
  if (tool === "batch") {
    const batch = z.object({ tool_calls: z.array(z.object({ tool: z.string(), parameters: z.unknown() })) }).safeParse(args);
    if (!batch.success) throw new ApiError(400, "wiki_file_arguments_invalid", "The batch cannot be checked against wiki permissions.");
    for (const call of batch.data.tool_calls) await assertWikiFileToolAccess(policy, call.tool, call.parameters);
    return;
  }
  if (["read", "grep", "glob", "list"].includes(tool)) {
    const input = z.record(z.string(), z.unknown()).parse(args);
    const path = tool === "read" ? input.filePath : input.path ?? policy.directory;
    if (typeof path !== "string" || !path || path.includes("\0")) throw new ApiError(400, "wiki_file_arguments_invalid", "Provide the path to read.");
    const target = await canonicalFolderPath(resolve(policy.directory, checkedToolPath(path)));
    if (policy.protectedRoots.some(root => overlaps(root, target)))
      throw new ApiError(403, "wiki_direct_read_denied", "Read other wikis through wiki tools, which check this chat's wiki access without requesting approval.");
    if (policy.runtimeRoots.some(root => overlaps(root, target)) && !wikiContentPath(policy, target))
      throw new ApiError(403, "wiki_runtime_read_denied", "Private LegalWork runtime files are unavailable to agent file tools. Wiki content remains readable through wiki tools.");
    return;
  }
  for (const path of mutationPaths(tool, args)) {
    const lexicalPath = resolve(policy.directory, path);
    const target = await canonicalFolderPath(lexicalPath);
    if (policy.protectedRoots.some(root => overlaps(root, target))) throw denied();
    if (policy.ownRoot && within(policy.ownRoot, target) && !policy.ownWritable)
      throw new ApiError(403, "wiki_read_only", "This chat has read-only access to its wiki.");
    if (policy.protectedRoots.length && (engineConfigPath(lexicalPath) || engineConfigPath(target)))
      throw new ApiError(403, "wiki_engine_config_write_denied", "Agent file tools cannot change executable engine configuration while external wikis are protected. Use the application settings.");
    if (policy.runtimeRoots.some(root => overlaps(root, target)) && !(policy.ownRoot && within(policy.ownRoot, target)))
      throw new ApiError(403, "wiki_policy_write_denied", "Agent file tools cannot change LegalWork's wiki registration or private runtime. Use the application settings.");
    // Editing an existing hard link could otherwise change a wiki through an
    // unrelated filename. The VM's staged replacements do not have this issue.
    if (policy.protectedRoots.length) {
      const info = await lstat(target).catch(error => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });
      if (info?.isFile() && info.nlink > 1) throw new ApiError(403, "wiki_linked_file_write_denied", "Edit a separate copy of this linked file; ordinary file tools cannot safely determine whether another link belongs to a wiki.");
    }
  }
}

/** Keep optional external wiki mounts read-only. Refuse broad writable mounts
 * instead of allowing a parent mount to bypass a protected wiki child. */
export async function wikiSafeSandboxMounts(policy: WikiFilePolicy, mounts: SandboxMount[]): Promise<SandboxMount[]> {
  const result: SandboxMount[] = [];
  for (const mount of mounts) {
    const source = await realpath(mount.source);
    if (!mount.writable) { result.push({ ...mount, source }); continue; }
    if (policy.protectedRoots.some(root => within(root, source))) {
      result.push({ ...mount, source, writable: false });
      continue;
    }
    if (policy.protectedRoots.some(root => within(source, root)))
      throw new ApiError(403, "wiki_sandbox_mount_denied", "An authorized folder contains an external wiki. Choose narrower folders for shell access and use approved wiki tools for wiki changes.");
    result.push({ ...mount, source });
  }
  return result;
}
