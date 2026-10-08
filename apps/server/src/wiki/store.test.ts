import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { WikiStore } from "./store.js";

const roots: string[] = [], stores: WikiStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-"));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "wiki-client", hostToken: "wiki-host", configPath: join(root, "config", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const store = new WikiStore(config);
  stores.push(store);
  return { root, config, store };
}

describe("Markdown wiki store", () => {
  test("file explorer creates empty nested folders and copies or moves complete folder contents", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Explorer", template: "blank" });
    await store.changeEntry(wiki.id, { action: "create-folder", path: "Research/Empty" });
    expect((await store.snapshot(wiki.id)).folders).toContain("Research/Empty");
    const source = "---\nowner: Test\n---\n# Untouched\n";
    await store.write(wiki.id, "Research/Note.md", source, "");
    const bytes = Buffer.from([0, 255, 12, 89]);
    await store.writeAsset(wiki.id, "Research/scan.png", bytes, "");
    const entry = await store.entry(wiki.id, "Research");
    await store.changeEntry(wiki.id, { action: "copy", path: entry.path, destination: "Research copy", baseRevision: entry.revision });
    expect((await store.read(wiki.id, "Research copy/Note.md")).content).toBe(source);
    expect(await store.readAsset(wiki.id, "Research copy/scan.png")).toEqual(bytes);
    expect((await store.snapshot(wiki.id)).folders).toContain("Research copy/Empty");
    await store.changeEntry(wiki.id, { action: "move", path: entry.path, destination: "Archive/Research", baseRevision: entry.revision });
    const snapshot = await store.snapshot(wiki.id);
    expect(snapshot.folders).toContain("Archive/Research/Empty");
    expect(snapshot.pages.some((page) => page.path === "Research/Note.md")).toBe(false);
    expect((await store.read(wiki.id, "Archive/Research/Note.md")).content).toBe(source);
    expect(await store.readAsset(wiki.id, "Archive/Research/scan.png")).toEqual(bytes);
  });

  test("folder actions reject stale revisions and occupied destinations without changing originals", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Conflicts" });
    const page = await store.write(wiki.id, "Work/Note.md", "# Original\n", "");
    const original = await store.entry(wiki.id, "Work");
    await store.write(wiki.id, page.path, "# Newer\n", page.revision);
    await expect(store.changeEntry(wiki.id, { action: "trash", path: original.path, baseRevision: original.revision })).rejects.toMatchObject({ code: "wiki_revision_conflict" });
    await store.changeEntry(wiki.id, { action: "create-folder", path: "Occupied" });
    const fresh = await store.entry(wiki.id, "Work");
    await expect(store.changeEntry(wiki.id, { action: "move", path: fresh.path, destination: "Occupied", baseRevision: fresh.revision })).rejects.toMatchObject({ status: 409, code: "wiki_entry_exists" });
    await expect(store.changeEntry(wiki.id, { action: "copy", path: fresh.path, destination: "Work/Nested", baseRevision: fresh.revision })).rejects.toMatchObject({ code: "invalid_wiki_destination" });
    expect((await store.read(wiki.id, page.path)).content).toBe("# Newer\n");
    expect(await store.trash(wiki.id)).toEqual([]);
  });

  test("trash and restore retain page bytes, binary assets and empty directories without overwriting newer files", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Recover" });
    const page = await store.write(wiki.id, "Matter/Note.md", "# Kept verbatim\n", "");
    await store.writeAsset(wiki.id, "Matter/file.bin", Buffer.from([0, 255]), "");
    await store.changeEntry(wiki.id, { action: "create-folder", path: "Matter/Empty" });
    const entry = await store.entry(wiki.id, "Matter");
    await store.changeEntry(wiki.id, { action: "trash", path: entry.path, baseRevision: entry.revision });
    expect((await store.snapshot(wiki.id)).pages.some((item) => item.path === page.path)).toBe(false);
    expect((await store.files(wiki.id)).some((item) => item.path.includes("legalwork-trash"))).toBe(false);
    const [deleted] = await store.trash(wiki.id);
    expect(deleted?.path).toBe("Matter");
    await store.changeEntry(wiki.id, { action: "create-folder", path: "Matter" });
    await expect(store.changeEntry(wiki.id, { action: "restore", trashId: deleted.id })).rejects.toMatchObject({ status: 409, code: "wiki_entry_exists" });
    expect(await store.trash(wiki.id)).toHaveLength(1);
    await rm(join(wiki.root, "Matter"), { recursive: true });
    await store.changeEntry(wiki.id, { action: "restore", trashId: deleted.id });
    expect((await store.read(wiki.id, page.path)).content).toBe(page.content);
    expect(await store.readAsset(wiki.id, "Matter/file.bin")).toEqual(Buffer.from([0, 255]));
    expect((await store.snapshot(wiki.id)).folders).toContain("Matter/Empty");
    expect(await store.trash(wiki.id)).toEqual([]);
  });

  test("file actions reject traversal and symbolic links, including links inside folders", async () => {
    const { store, root } = await fixture(), wiki = await store.create({ name: "Safety" });
    const page = await store.write(wiki.id, "Work/Note.md", "# Original\n", "");
    const file = await store.entry(wiki.id, page.path);
    await expect(store.changeEntry(wiki.id, { action: "copy", path: page.path, destination: "../Outside.md", baseRevision: file.revision })).rejects.toMatchObject({ status: 400 });
    await symlink(root, join(wiki.root, "Work/Escape"), "dir");
    await expect(store.entry(wiki.id, "Work")).rejects.toMatchObject({ code: "unsafe_wiki_path" });
    await expect(store.changeEntry(wiki.id, { action: "create-folder", path: "Work/Escape/Created" })).rejects.toMatchObject({ code: "unsafe_wiki_path" });
    expect((await store.read(wiki.id, page.path)).content).toBe(page.content);
  });

  test("creates portable starter files, registers a wiki workspace, and forgets without deleting content", async () => {
    const { root, config, store } = await fixture();
    const wiki = await store.create({ name: "VC knowledge", root: join(root, "content"), template: "firm" });
    expect(config.workspaces.find((workspace) => workspace.id === wiki.workspaceId)?.path).toBe(wiki.root);
    const registry = await readFile(store.path, "utf8");
    expect(registry).toContain("wikis:");
    const configMarkdown = await readFile(join(wiki.root, "Wiki.md"), "utf8");
    expect(configMarkdown).toContain("VC knowledge");
    expect(configMarkdown).not.toContain("workspaceId");
    expect(configMarkdown).not.toContain(wiki.root);
    const snapshot = await store.snapshot(wiki.id);
    expect(snapshot.pages.some((page) => page.path === "Structure.md")).toBe(true);
    expect(snapshot.pages.some((page) => page.path === "Skills/Bootstrap.md")).toBe(true);
    expect(snapshot.views.some((view) => view.type === "table")).toBe(true);
    const original = await store.write(wiki.id, "Recover.md", "# Recover\n", "");
    await store.forget(wiki.id);
    expect(await store.list()).toEqual([]);
    expect(await readFile(join(wiki.root, "Structure.md"), "utf8")).toContain("Wiki structure");
    const reattached = await store.create({ name: "Reattached", root: wiki.root, attach: true });
    expect(reattached.id).toBe(wiki.id);
    expect((await store.history(reattached.id, original.path))).toHaveLength(1);
  });

  test("attaching to a shared folder preserves local originals and seeds no starter files", async () => {
    const { root, store } = await fixture();
    const folder = join(root, "existing");
    await mkdir(folder);
    await writeFile(join(folder, "Original.md"), "# Original\n");
    const wiki = await store.create({ name: "Shared", root: folder, attach: true, sync: { workspaceId: "project", connectionId: "team", path: "Knowledge" } });
    expect((await store.files(wiki.id)).map((file) => file.path)).toEqual(["Original.md"]);
    expect(await readFile(join(folder, "Original.md"), "utf8")).toBe("# Original\n");
  });

  test("project selection persists in the registry and wiki/project folder overlaps fail safely", async () => {
    const { root, config, store } = await fixture();
    const project = join(root, "project");
    await mkdir(project);
    config.workspaces.push({ id: "project", name: "Project", path: project, preset: "starter", workspaceType: "local" });
    await expect(store.create({ name: "Nested", root: join(project, "Wiki") })).rejects.toMatchObject({ status: 409, code: "wiki_workspace_overlap" });
    const wiki = await store.create({ name: "Independent", root: join(root, "independent") });
    await store.update(wiki.id, { projectWorkspaceIds: ["project"] });
    expect((await store.get(wiki.id)).projectWorkspaceIds).toEqual(["project"]);
    await store.update(wiki.id, { projectWorkspaceIds: [] });
    expect((await store.get(wiki.id)).projectWorkspaceIds).toEqual([]);
    await store.update(wiki.id, { projectWorkspaceIds: null });
    expect((await store.get(wiki.id)).projectWorkspaceIds).toBe(null);
    config.workspaces.push({ id: "bypass", name: "Bypass", path: wiki.root, preset: "starter", workspaceType: "local" });
    await expect(store.list()).rejects.toMatchObject({ status: 409, code: "wiki_workspace_overlap" });
  });

  test("indexes properties, body and property links, resolves aliases, and searches full content", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Index" });
    const source = "---\ntype: process\nowner: '[[People/Ada.md]]'\npractice: venture\nreviewed: 2026-10-07\n---\n# Financing\n\nSee [[Partner]] and [Ada](../People/Ada.md).\n\nLiquidation preferences.\n";
    await store.write(wiki.id, "Processes/Financing.md", source, "");
    await store.write(wiki.id, "People/Ada.md", "---\naliases: [Partner]\ntype: person\n---\n# Ada\n", "");
    await store.write(wiki.id, "People/Other.md", "# Ada\n", "");
    const snapshot = await store.snapshot(wiki.id), page = snapshot.pages.find((item) => item.path === "Processes/Financing.md");
    expect(page?.properties.reviewed).toBe("2026-10-07");
    expect(page?.links).toHaveLength(3);
    expect(page?.links.every((link) => link.resolved && link.target === "People/Ada.md")).toBe(true);
    expect(page?.links.find((link) => link.property === "owner")).toBeDefined();
    expect((await store.search(wiki.id, "Liquidation", "process")).map((item) => item.path)).toEqual(["Processes/Financing.md"]);
    expect((await store.search(wiki.id, 'preferences" OR *', "process"))).toEqual([]);
    expect((await store.read(wiki.id, "Processes/Financing.md")).content).toBe(source);
    const imported = "\uFEFF---\r\ntype: deal\r\nstage: closing\r\n...\r\n# Imported deal\r\n";
    await store.write(wiki.id, "Imported.md", imported, "");
    expect((await store.snapshot(wiki.id)).pages.find((item) => item.path === "Imported.md")?.properties.stage).toBe("closing");
    expect((await store.read(wiki.id, "Imported.md")).content).toBe(imported);
  });

  test("serialized compare-and-save rejects stale edits and simultaneous creations", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Concurrency" });
    const initial = await store.write(wiki.id, "Concurrent.md", "# Original\n", "");
    const writes = await Promise.allSettled([
      store.write(wiki.id, "Concurrent.md", "# First\n", initial.revision),
      store.write(wiki.id, "Concurrent.md", "# Second\n", initial.revision),
    ]);
    expect(writes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((item) => item.status === "rejected")).toHaveLength(1);
    await expect(store.write(wiki.id, "Concurrent.md", "# Overwrite\n", "")).rejects.toMatchObject({ status: 409 });
    await expect(store.remove(wiki.id, "Concurrent.md", initial.revision)).rejects.toMatchObject({ status: 409 });
    const creates = await Promise.allSettled([store.write(wiki.id, "New.md", "A", ""), store.write(wiki.id, "New.md", "B", "")]);
    expect(creates.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  });

  test("view definitions stay in editable Markdown files and refresh after external changes", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Views" });
    const source = "---\nviews:\n  - name: Deals\n    type: kanban\n    filter: { type: deal, practice: venture }\n    columns: [lead, closing, completed]\n    groupBy: stage\n---\n# My deal board\n";
    await store.write(wiki.id, "Views/Deals.md", source, "");
    const first = (await store.snapshot(wiki.id)).views.find((view) => view.name === "Deals");
    expect(first).toEqual({ name: "Deals", type: "kanban", filter: { type: "deal", practice: "venture" }, columns: ["lead", "closing", "completed"], groupBy: "stage" });
    await writeFile(join(wiki.root, "Views/Deals.md"), source.replace("practice: venture", "practice: litigation"));
    expect((await store.snapshot(wiki.id)).views.find((view) => view.name === "Deals")?.filter.practice).toBe("litigation");
  });

  test("records external edits and deletions, recovers deleted pages, and keeps history across restarts", async () => {
    const { store, config } = await fixture(), wiki = await store.create({ name: "History" });
    await store.write(wiki.id, "History.md", "# First\n", "");
    await writeFile(join(wiki.root, "History.md"), "# External edit\n");
    const external = await store.snapshot(wiki.id);
    expect(external.pages.find((page) => page.path === "History.md")?.title).toBe("External edit");
    await rm(join(wiki.root, "History.md"));
    expect((await store.snapshot(wiki.id)).pages.some((page) => page.path === "History.md")).toBe(false);
    const history = await store.history(wiki.id, "History.md");
    expect(history.map((revision) => revision.action)).toEqual(["delete", "write", "write"]);
    expect((await store.history(wiki.id)).some((revision) => revision.path === "History.md" && revision.action === "delete")).toBe(true);
    const first = history[history.length - 1];
    const restored = await store.restore(wiki.id, "History.md", first.id, "");
    expect(restored.content).toBe("# First\n");
    await store.close();
    const reopened = new WikiStore(config);
    stores.push(reopened);
    expect((await reopened.snapshot(wiki.id)).pages.find((page) => page.path === "History.md")?.title).toBe("First");
    expect((await reopened.history(wiki.id, "History.md"))[0].action).toBe("restore");
    const other = await reopened.create({ name: "Other" });
    await expect(reopened.restore(other.id, "History.md", first.id, "")).rejects.toMatchObject({ status: 404 });
  });

  test("rejects traversal, hidden paths and symlink escapes for pages and assets", async () => {
    const { root, store } = await fixture(), wiki = await store.create({ name: "Safety" });
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "Secret.md"), "secret");
    await symlink(outside, join(wiki.root, "Escape"), "dir");
    await symlink(join(outside, "Secret.md"), join(wiki.root, "Linked.md"));
    for (const path of ["../Secret.md", "/etc/passwd", "Folder/../../Secret.md", ".opencode/config.md", "Folder\\Secret.md"]) {
      await expect(store.readAsset(wiki.id, path)).rejects.toMatchObject({ status: 400 });
      await expect(store.write(wiki.id, path, "bad", "")).rejects.toMatchObject({ status: 400 });
    }
    await expect(store.read(wiki.id, "Escape/Secret.md")).rejects.toMatchObject({ status: 403 });
    await expect(store.write(wiki.id, "Escape/New.md", "bad", "")).rejects.toMatchObject({ status: 403 });
    await expect(store.read(wiki.id, "Linked.md")).rejects.toMatchObject({ status: 403 });
    expect((await store.snapshot(wiki.id)).warnings.join(" ")).toContain("symbolic links");
    expect(await readFile(join(outside, "Secret.md"), "utf8")).toBe("secret");
  });

  test("asset bytes round-trip with compare-and-save and malformed YAML stays editable", async () => {
    const { store } = await fixture(), wiki = await store.create({ name: "Assets" });
    const bytes = Buffer.from([0, 255, 137, 80, 78, 71]);
    await store.writeAsset(wiki.id, "Attachments/scan.png", bytes, "");
    expect(await store.readAsset(wiki.id, "Attachments/scan.png")).toEqual(bytes);
    await expect(store.writeAsset(wiki.id, "Attachments/scan.png", Buffer.from("overwrite"), "")).rejects.toMatchObject({ status: 409 });
    expect((await store.snapshot(wiki.id)).assets.find((asset) => asset.path === "Attachments/scan.png")?.size).toBe(bytes.length);
    const invalid = "---\ntype: [broken\n---\n# Still editable\n";
    await store.write(wiki.id, "Broken.md", invalid, "");
    expect((await store.read(wiki.id, "Broken.md")).content).toBe(invalid);
    expect((await store.snapshot(wiki.id)).warnings.some((warning) => warning.startsWith("Broken.md:"))).toBe(true);
  });
});
