import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { EmailDraft, EmailDraftInput } from "@legalwork/types/email-draft";
import { ApiError } from "../errors.js";
import { canonicalFilePath, withFileWriteLocks } from "../file-write-lock.js";
import { renderEml, type EmailAttachment } from "./eml.js";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function draftPaths(root: string, id: string, kind: "email" | "calendar" = "email") {
  if (!validId.test(id)) throw new ApiError(400, "email_draft_id", "Invalid email draft.");
  const path = `.legalwork/${kind}-drafts/${id}.${kind === "email" ? "eml" : "ics"}`;
  const artifact = await containedPath(root, path);
  const metadata = await containedPath(root, path.replace(/\.(eml|ics)$/, ".json"));
  return { path, artifact, metadata };
}

async function containedPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.includes("\\") || path.includes("\u0000") || path.split("/").some(part => part === "..")) {
    throw new ApiError(400, "email_draft_path", "Choose a file inside this project.");
  }
  const canonicalRoot = await canonicalFilePath(resolve(root));
  const target = await canonicalFilePath(resolve(canonicalRoot, path));
  const child = relative(canonicalRoot, target);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new ApiError(400, "email_draft_path", "Choose a file inside this project.");
  }
  return target;
}

async function attachmentData(root: string, input: EmailDraftInput): Promise<EmailAttachment[]> {
  let total = 0;
  const attachments: EmailAttachment[] = [];
  for (const item of input.attachments) {
    const target = await containedPath(root, item.path);
    // Open the validated target without following a replaced leaf symlink.
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new ApiError(400, "email_attachment", "Attachments must be files.");
      total += info.size;
      if (total > MAX_ATTACHMENT_BYTES) throw new ApiError(413, "email_attachment_size", "Attachments must total 20 MB or less.");
      const data = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
        if (!bytesRead) throw new ApiError(409, "email_attachment_changed", "An attachment changed. Save the draft again.");
        offset += bytesRead;
      }
      if ((await file.stat()).size !== info.size) throw new ApiError(409, "email_attachment_changed", "An attachment changed. Save the draft again.");
      attachments.push({ name: item.name || basename(target), contentType: item.contentType, data });
    } finally { await file.close(); }
  }
  return attachments;
}

export async function readDraft(root: string, id: string, kind: "email" | "calendar" = "email"): Promise<unknown> {
  const paths = await draftPaths(root, id, kind);
  try { return JSON.parse(await readFile(paths.metadata, "utf8")); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new ApiError(404, "email_draft_missing", "Email draft not found.");
    throw error;
  }
}

export async function saveEmailDraft(root: string, workspaceId: string, input: EmailDraftInput, previous?: { id: string; revision: string }): Promise<EmailDraft> {
  return saveDraftFiles(root, workspaceId, "email", async () => ({ input, content: renderEml(input, await attachmentData(root, input)) }), previous);
}

export async function saveDraftFiles<T extends object>(root: string, workspaceId: string, kind: "email" | "calendar", prepare: (id: string, previous: unknown) => Promise<{ input: T; content: string }>, previous?: { id: string; revision: string }) {
  const id = previous?.id ?? randomUUID();
  const paths = await draftPaths(root, id, kind);
  return withFileWriteLocks([paths.metadata, paths.artifact], async () => {
    const current = previous ? await readDraft(root, id, kind) : null;
    if (previous) {
      if (!current || typeof current !== "object" || !("revision" in current) || current.revision !== previous.revision || !("workspaceId" in current) || current.workspaceId !== workspaceId) {
        throw new ApiError(409, "draft_conflict", "This draft changed. Reload it before saving; your edits are still here.");
      }
    }
    const { input, content } = await prepare(id, current);
    const draft = { ...input, id, workspaceId, revision: randomUUID(), path: paths.path, updatedAt: Date.now() };
    await mkdir(dirname(paths.metadata), { recursive: true });
    await draftPaths(root, id, kind);
    const suffix = `.tmp-${randomUUID()}`;
    const artifactTemp = paths.artifact + suffix, jsonTemp = paths.metadata + suffix;
    try {
      const artifact = await open(artifactTemp, "wx", 0o600);
      try { await artifact.writeFile(content, "utf8"); } finally { await artifact.close(); }
      const jsonFile = await open(jsonTemp, "wx", 0o600);
      try { await jsonFile.writeFile(JSON.stringify(draft), "utf8"); } finally { await jsonFile.close(); }
      await rename(artifactTemp, paths.artifact);
      await rename(jsonTemp, paths.metadata);
    } finally { await Promise.all([rm(artifactTemp, { force: true }), rm(jsonTemp, { force: true })]); }
    return draft;
  });
}
