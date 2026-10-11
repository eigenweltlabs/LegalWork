import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewInput } from "@legalwork/types/views";
import { ViewRepository, workspaceViewFiles } from "./repository.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "legalwork-views-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const input: ViewInput = { version: 1, title: "Client review", mode: "report", catalog: "legalwork-1", program: 'root = Text("Review complete")', queries: {},
  datasets: { clients: { rows: [{ title: "Client", amount: 0, approved: false }], total: 1, revision: "source-1", asOf: 100, truncated: false } } };
const repository = () => new ViewRepository({ kind: "workspace", id: "test-project" }, workspaceViewFiles(root));

describe("saved view records", () => {
  test("frozen report and identity survive reopen and file rename", async () => {
    const saved = await repository().create(input);
    expect(await repository().read(saved.id)).toEqual(saved);
    await rename(join(root, "Views", `${saved.id}.view.json`), join(root, "Renamed.view.json"));
    const next = await repository().update(saved.id, { ...input, title: "Renamed report" }, saved.revision);
    expect(next.id).toBe(saved.id);
    expect(next.datasets).toEqual(input.datasets);
    expect(JSON.parse(await readFile(join(root, "Renamed.view.json"), "utf8")).title).toBe("Renamed report");
  });
  test("stale revision cannot replace a saved report", async () => {
    const repo = repository(), saved = await repo.create(input);
    await repo.update(saved.id, { ...input, title: "First edit" }, saved.revision);
    await expect(repo.update(saved.id, { ...input, title: "Stale edit" }, saved.revision)).rejects.toMatchObject({ status: 409 });
    expect((await repo.read(saved.id)).title).toBe("First edit");
  });
  test("duplicate IDs and sync conflict copies remain visible as conflicts", async () => {
    const repo = repository(), saved = await repo.create(input);
    const unrelated = await repo.create({ ...input, title: "Unrelated report" });
    const bytes = await readFile(join(root, "Views", `${saved.id}.view.json`));
    await writeFile(join(root, "Views", `${saved.id}.view.conflict-0123456789ab.json`), bytes);
    await expect(repo.read(saved.id)).rejects.toMatchObject({ code: "view_revision_conflict" });
    expect(await readFile(join(root, "Views", `${saved.id}.view.json`))).toEqual(bytes);
    expect((await repo.list()).issues[0].code).toBe("view_revision_conflict");
    expect((await repo.read(unrelated.id)).title).toBe("Unrelated report");
  });
  test("external malformed records are validated on read", async () => {
    await writeFile(join(root, "Broken.view.json"), '{"id":"invalid"}');
    expect((await repository().list()).issues[0].code).toBe("view_invalid_record");
  });
  test("a workspace report cannot make a live wiki query", async () => {
    await expect(repository().create({ ...input, mode: "dashboard" })).rejects.toMatchObject({ code: "workspace_view_requires_snapshot" });
    await expect(repository().create({ ...input, queries: { data: { fields: ["title"] } } })).rejects.toMatchObject({ code: "workspace_view_requires_snapshot" });
  });
  test("symlinked destination cannot write outside the workspace", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "legalwork-outside-"));
    try {
      await symlink(elsewhere, join(root, "Views"));
      await expect(repository().create(input)).rejects.toMatchObject({ status: 403 });
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  });
  test("simultaneous edits permit only one winner", async () => {
    const saved = await repository().create(input);
    const outcomes = await Promise.allSettled([
      repository().update(saved.id, { ...input, title: "A" }, saved.revision),
      repository().update(saved.id, { ...input, title: "B" }, saved.revision),
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
  });
});
