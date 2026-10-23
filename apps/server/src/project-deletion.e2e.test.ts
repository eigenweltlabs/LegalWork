import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { readProjectFileLinks, updateProjectFileLinks } from "./project-file-links.js";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { deleteProjectData } from "./project-deletion.js";
import { calendarStore } from "./calendar/store.js";
import { taskStore } from "./task-store.js";
import { ScheduledTaskStore } from "./scheduled-tasks/store.js";
import { ViewRepository, workspaceViewFiles } from "./views/repository.js";
import { DocumentPreparation } from "./document-preparation/service.js";
import { OcrManager } from "./ocr/manager.js";
import { OcrService } from "./ocr/service.js";
import { withProjectMutation } from "./project-deletion-gate.js";
import { ReviewService } from "./reviews/service.js";
import { ReviewDefaults } from "./reviews/storage.js";
import { CorpusService } from "./corpus/service.js";
import { projectSyncStore } from "./project-sync-store.js";
import { runtimeDbPath } from "./runtime-db.js";

const cleanup: Array<() => void | Promise<void>> = [];
const previousData = process.env.LEGALWORK_DATA_DIR;
const previousDb = process.env.LEGALWORK_RUNTIME_DB;
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
  if (previousData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
});
type Chat = { id: string; directory: string; parentID?: string; time: { created: number; updated: number; archived?: number } };
const reviewSchema = z.object({ token: z.string(), deleteFolder: z.boolean(), chatCount: z.number(), copies: z.array(z.object({ projectId: z.string() })) });
async function fixture(external = false) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-project-deletion-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const managed = join(root, "projects"), folder = join(external ? root : managed, "source"), other = join(managed, "other"), third = join(managed, "third"), outside = join(root, "external");
  for (const path of [folder, other, third, outside]) await mkdir(path, { recursive: true });
  await writeFile(join(folder, "contract.docx"), "Original contract");
  await writeFile(join(outside, "keep.txt"), "External original");
  const chats = new Map<string, Chat>();
  const addChat = (id: string, directory = folder, parentID?: string) => chats.set(id, { id, directory, parentID, time: { created: 1, updated: 1 } });
  addChat("chat"); addChat("child", folder, "chat"); addChat("unrelated", other);
  const state: { busy: boolean; failDelete: boolean; deleted: string[]; beforeMessages?: () => Promise<void> } = { busy: false, failDelete: false, deleted: [] };
  const remove = (id: string) => { for (const child of [...chats.values()].filter(chat => chat.parentID === id)) remove(child.id); chats.delete(id); };
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/session") return Response.json([...chats.values()].slice(0, Number(url.searchParams.get("limit") || 100)));
    if (path === "/session/status") return Response.json(state.busy ? { chat: { type: "busy" } } : {});
    const match = path.match(/^\/session\/([^/]+)(\/.*)?$/);
    if (match) {
      const id = match[1];
      if (match[2] === "/children") return Response.json([...chats.values()].filter(chat => chat.parentID === id));
      if (match[2] === "/message") { await state.beforeMessages?.(); return Response.json([]); }
      if (!chats.has(id)) return Response.json({ error: "not_found" }, { status: 404 });
      if (request.method === "DELETE") {
        if (state.failDelete) return Response.json({ error: "unavailable" }, { status: 503 });
        state.deleted.push(id); remove(id); return Response.json(true);
      }
      return Response.json(chats.get(id));
    }
    return Response.json({});
  } });
  cleanup.push(() => { engine.stop(true); });
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
    projectsDirectory: managed, approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [ { id: "source", name: "Source", path: folder }, { id: "other", name: "Other", path: other }, { id: "third", name: "Third", path: third } ].map(item => ({ ...item, preset: "starter", workspaceType: "local", baseUrl: `http://127.0.0.1:${engine.port}` })),
    authorizedRoots: [folder, other, third], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  await writeFile(config.configPath!, JSON.stringify({ workspaces: config.workspaces, authorizedRoots: config.authorizedRoots }));
  const server = await startServer(config); cleanup.push(() => server.stop());
  const request = (path: string, method = "GET", body?: unknown, host = true) => fetch(`http://127.0.0.1:${server.port}${path}`, {
    method, headers: { authorization: "Bearer client", ...(host ? { "x-legalwork-host-token": "host" } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const review = async () => {
    const response = await request("/workspaces/source/deletion");
    const payload = await response.json();
    expect(response.status).toBe(200);
    return reviewSchema.parse(payload);
  };
  const linked = async (destination: string, path = "contract.docx") => updateProjectFileLinks(destination, links => [...links, {
    id: crypto.randomUUID(), name: "contract.docx", folder: "", createdAt: 1,
    source: { projectId: "source", workspaceId: "source", path, name: "contract.docx" },
  }]);
  return { root, folder, managed, other, third, outside, state, chats, addChat, config, request, review, linked };
}

test("deletes managed files and all chats; retains external targets and independent copies in every linked project", async () => {
  const f = await fixture();
  await symlink(f.outside, join(f.folder, "linked-folder"));
  await symlink(join(f.outside, "keep.txt"), join(f.folder, "linked-file.txt"));
  await f.linked(f.other); await f.linked(f.third);
  await writeFile(join(f.other, "contract.docx"), "Keep existing destination");
  for (let index = 0; index < 150; index++) f.addChat(`older-${index}`);
  const archived = f.chats.get("older-0")!; archived.time.archived = 123;
  const review = await f.review();
  expect(review).toMatchObject({ deleteFolder: true, chatCount: 152 });
  expect(review.copies).toHaveLength(2);
  const response = await f.request("/workspaces/source/delete-project", "POST", { token: review.token });
  const payload = await response.json();
  expect(response.status).toBe(200);
  expect(payload).toMatchObject({ ok: true, copiedFiles: 2 });
  expect(await stat(f.folder).catch(() => null)).toBeNull();
  expect([...f.chats.keys()]).toEqual(["unrelated"]);
  expect(await readFile(join(f.outside, "keep.txt"), "utf8")).toBe("External original");
  expect(await readFile(join(f.other, "contract.docx"), "utf8")).toBe("Keep existing destination");
  expect(await readFile(join(f.other, "contract (2).docx"), "utf8")).toBe("Original contract");
  expect(await readFile(join(f.third, "contract.docx"), "utf8")).toBe("Original contract");
  expect(await readProjectFileLinks(f.other)).toEqual([]);
  expect(await readProjectFileLinks(f.third)).toEqual([]);
  await writeFile(join(f.other, "contract (2).docx"), "Edited independently");
  expect(await readFile(join(f.third, "contract.docx"), "utf8")).toBe("Original contract");
  expect(f.config.workspaces.map(item => item.id)).toEqual(["other", "third"]);
  expect(JSON.parse(await readFile(f.config.configPath!, "utf8")).workspaces.map((item: { id: string }) => item.id)).toEqual(["other", "third"]);
});

test("an external project folder remains intact while its chats and registration are deleted", async () => {
  const f = await fixture(true), review = await f.review();
  expect(review.deleteFolder).toBe(false);
  const response = await f.request("/workspaces/source/delete-project", "POST", { token: review.token });
  expect(response.status).toBe(200); await response.arrayBuffer();
  expect(await readFile(join(f.folder, "contract.docx"), "utf8")).toBe("Original contract");
  expect([...f.chats.keys()]).toEqual(["unrelated"]);
});

test("a project root symlink outside managed storage is retained with its target", async () => {
  const f = await fixture();
  await rm(f.folder, { recursive: true }); await symlink(f.outside, f.folder);
  const review = await f.review(); expect(review.deleteFolder).toBe(false);
  const response = await f.request("/workspaces/source/delete-project", "POST", { token: review.token });
  expect(response.status).toBe(200); await response.arrayBuffer();
  expect(await readFile(join(f.folder, "keep.txt"), "utf8")).toBe("External original");
});

test("new chats invalidate confirmation; active chats and foreign descendants block deletion", async () => {
  const f = await fixture(), first = await f.review();
  f.addChat("new");
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: first.token })).status).toBe(409);
  const current = await f.review(); f.state.busy = true;
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: current.token })).status).toBe(409);
  f.state.busy = false; f.addChat("foreign-child", f.other, "chat");
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: current.token })).status).toBe(409);
  expect(f.state.deleted).toEqual([]);
  expect(await readFile(join(f.folder, "contract.docx"), "utf8")).toBe("Original contract");
});

test("a failed copy keeps the source, links and chats; engine failures never delete project files", async () => {
  const f = await fixture(); await f.linked(f.other, "missing.docx");
  const review = await f.review();
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).not.toBe(200);
  expect(f.state.deleted).toEqual([]);
  expect(await readProjectFileLinks(f.other)).toHaveLength(1);
  await updateProjectFileLinks(f.other, () => []);
  const retry = await f.review(); f.state.failDelete = true;
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: retry.token })).status).toBe(502);
  expect(await readFile(join(f.folder, "contract.docx"), "utf8")).toBe("Original contract");
  expect(f.config.workspaces.some(item => item.id === "source")).toBe(true);
});

test("destructive deletion requires host credentials and a review; old DELETE remains non-destructive", async () => {
  const f = await fixture();
  expect((await f.request("/workspaces/source/deletion", "GET", undefined, false)).status).toBe(401);
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: "x" }, false)).status).toBe(401);
  expect((await f.request("/workspaces/source/delete-project", "POST", {})).status).toBe(400);
  expect((await f.request("/workspaces/source", "DELETE")).status).toBe(200);
  expect(await readFile(join(f.folder, "contract.docx"), "utf8")).toBe("Original contract");
  expect(f.state.deleted).toEqual([]);
});

test("deletion excludes new chats and cross-project link mutations until it finishes", async () => {
  const f = await fixture(), review = await f.review();
  let entered = () => {}, release = () => {};
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  f.state.beforeMessages = async () => { entered(); await held; };
  const deleting = f.request("/workspaces/source/delete-project", "POST", { token: review.token });
  try {
    await reached;
    expect((await f.request("/workspace/source/opencode/session", "POST", {})).status).toBe(409);
    expect((await f.request("/workspace/other/files/links", "POST", {})).status).toBe(409);
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
  } finally { release(); }
  expect((await deleting).status).toBe(200);
});

test("overlapping project roots are never recursively deleted", async () => {
  const f = await fixture();
  f.config.workspaces.find(item => item.id === "other")!.path = join(f.folder, "nested");
  await mkdir(join(f.folder, "nested"));
  expect((await f.request("/workspaces/source/deletion")).status).toBe(409);
  expect(await readFile(join(f.folder, "contract.docx"), "utf8")).toBe("Original contract");
});

test("copies the actual linked source when its workspace differs from the owning project", async () => {
  const f = await fixture();
  await writeFile(join(f.third, "contract.docx"), "The actual linked original");
  await f.linked(f.other);
  await updateProjectFileLinks(f.other, links => links.map(link => ({ ...link, source: { ...link.source, workspaceId: "third" } })));
  const review = await f.review();
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(200);
  expect(await readFile(join(f.other, "contract.docx"), "utf8")).toBe("The actual linked original");
  expect(await readFile(join(f.third, "contract.docx"), "utf8")).toBe("The actual linked original");
  expect(await readProjectFileLinks(f.other)).toEqual([]);
});

test("connected originals become independent local copies without a remote delete", async () => {
  const f = await fixture();
  await f.linked(f.other);
  await updateProjectFileLinks(f.other, links => links.map(link => ({ ...link, source: { ...link.source, connectionId: "drive" } })));
  const workspace = f.config.workspaces[0], review = await f.review();
  const read: string[] = [];
  await deleteProjectData({ config: f.config, workspace, token: review.token, engine: createOpencodeClient({ baseUrl: workspace.baseUrl }),
    readConnected: async link => { read.push(link.source.connectionId!); return new TextEncoder().encode("Remote original"); },
    cleanupSession: async () => {}, beforeFiles: async () => {},
  });
  expect(read).toEqual(["drive"]);
  expect(await readFile(join(f.other, "contract.docx"), "utf8")).toBe("Remote original");
  expect(await readProjectFileLinks(f.other)).toEqual([]);
});

test("clears only this project's scheduled tasks, calendar and task records", async () => {
  const f = await fixture(), calendar = await calendarStore(f.config), tasks = await taskStore(f.config);
  const scheduled = await ScheduledTaskStore.open(runtimeDbPath(f.config));
  const input = { title: "Future work", prompt: "Summarize", schedule: { kind: "once", startAt: "2099-10-06T13:00:00", timeZone: "Europe/Vienna" },
    projectAccess: "project", sessionId: null, reuseChat: false, pinSession: true, model: null };
  const own = scheduled.create("source", input), kept = scheduled.create("other", input);
  calendar.create("source", { title: "Remove deadline", start: "2099-10-16" });
  const keptDeadline = calendar.create("other", { title: "Keep deadline", start: "2099-10-16" });
  const actor = { userId: null, name: null, email: null };
  const ownTask = tasks.createTask({ projectId: "source", title: "Remove task" }, actor);
  const keptTask = tasks.createTask({ projectId: "other", title: "Keep task" }, actor);
  const projects = await projectSyncStore(f.config);
  projects.saveLink({ workspaceId: "source", projectId: "remote-source", orgId: "firm", origin: "local", role: "owner", ownerUserId: null,
    settings: { access: "members", memberIds: [], scope: { documents: true, notes: true, tasks: true, recordings: false, metadata: true, reviews: false } },
    confirmed: true, remoteUpdatedAt: null, filesReconciledAt: null, state: "active", allowDeletions: false, lastSyncAt: null, lastError: null, report: null });
  const review = await f.review();
  const response = await f.request("/workspaces/source/delete-project", "POST", { token: review.token });
  expect(response.status).toBe(200);
  expect(projects.tasksRemoved("remote-source", "firm")).toBe(true);
  expect(projects.linkByWorkspace("source")).toBeNull();
  expect(scheduled.list("source")).toEqual([]);
  expect(scheduled.runs(own.id)).toEqual([]);
  expect(scheduled.list("other").map(task => task.id)).toEqual([kept.id]);
  expect(calendar.list("source", true)).toEqual([]);
  expect(calendar.list("other").map(item => item.id)).toEqual([keptDeadline.id]);
  expect(tasks.getTask(ownTask.id)).toBeNull();
  expect(tasks.getTask(keptTask.id)?.id).toBe(keptTask.id);
});

test("registration persistence failure remains retryable even after the folder was removed", async () => {
  const f = await fixture(), review = await f.review();
  const path = f.config.configPath!;
  await rm(path); await mkdir(path);
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
  expect(f.config.workspaces.some(workspace => workspace.id === "source")).toBe(true);
  expect(await stat(f.folder).catch(() => null)).toBeNull();
  await rm(path, { recursive: true }); await writeFile(path, "{}");
  const retry = await f.review();
  expect(retry.chatCount).toBe(0);
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: retry.token })).status).toBe(200);
  expect(f.config.workspaces.some(workspace => workspace.id === "source")).toBe(false);
});


test("duplicate dashboard links become distinct, readable and editable copies", async () => {
  const f = await fixture();
  const repository = new ViewRepository({ kind: "workspace", id: "source" }, workspaceViewFiles(f.folder));
  const input = { version: 1, title: "Saved dashboard", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Hello")', queries: {},
    datasets: { source: { rows: [{ title: "Evidence" }], total: 1, revision: "original", asOf: 1, truncated: false } } } satisfies import("@legalwork/types/views").ViewInput;
  const view = await repository.create(input), path = await repository.location(view.id);
  await mkdir(join(f.other, "Documents"));
  // An existing independent copy with the original ID must also remain usable.
  await writeFile(join(f.other, "original.view.json"), await readFile(join(f.folder, path)));
  await updateProjectFileLinks(f.other, () => ["", "Documents"].map(folder => ({ id: crypto.randomUUID(), name: folder ? "Dashboard v1.2" : "dashboard.view.json", folder, createdAt: 1,
    source: { projectId: "source", workspaceId: "source", path, name: "dashboard.view.json" } })));
  const review = await f.review();
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(200);
  const copies = new ViewRepository({ kind: "workspace", id: "other" }, workspaceViewFiles(f.other));
  const listed = await copies.list();
  expect(listed.issues).toEqual([]); expect(listed.items).toHaveLength(3);
  expect(new Set(listed.items.map(item => item.id)).size).toBe(3);
  for (const item of listed.items) expect(await copies.read(item.id)).toMatchObject(input);
  const copied = listed.items.find(item => item.id !== view.id)!;
  await copies.update(copied.id, { ...input, title: "Edited copy" }, copied.revision);
  expect((await copies.read(view.id)).title).toBe("Saved dashboard");
  expect(await readProjectFileLinks(f.other)).toEqual([]);
});

test("an invalid linked dashboard blocks deletion without discarding the source or link", async () => {
  const f = await fixture();
  await writeFile(join(f.folder, "broken.view.json"), "{broken");
  await f.linked(f.other, "broken.view.json");
  const review = await f.review();
  expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
  expect(f.state.deleted).toEqual([]);
  expect(await readProjectFileLinks(f.other)).toHaveLength(1);
  expect(await readFile(join(f.folder, "broken.view.json"), "utf8")).toBe("{broken");
});

test("queued and cancelled document preparation block deletion until their final writes finish", async () => {
  const f = await fixture();
  await writeFile(join(f.folder, "document.pdf"), "fixture rendered by injected renderer");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const jobs: Promise<void>[] = [];
  const preparation = new DocumentPreparation(new OcrManager(join(f.root, "ocr")), {
    runBackground: run => { const job = withProjectMutation(f.config, run); jobs.push(job); return job; },
    snapshot: async () => ({ fingerprint: "fixture", service: new OcrService([{ info: { id: "test", label: "Test", execution: "local", model: "test", languages: null, regions: true, warnings: [] },
      recognize: async () => ({ text: "Evidence", regions: [], truncated: false }) }], "test") }),
    open: async () => ({ pageCount: 1, close: async () => {}, page: async number => {
      entered(); await held;
      return { nativeText: "Confidential source text. ".repeat(20), image: { pageNumber: number, mimeType: "image/png", width: 10, height: 10, data: new Uint8Array() } };
    } }),
  });
  try {
    const first = await preparation.start(f.folder, { files: ["document.pdf"], ocr: "missing-text" });
    await started;
    const queued = await preparation.start(f.folder, { files: ["document.pdf"], ocr: "missing-text" });
    expect(queued.status).toBe("queued");
    await preparation.cancel(f.folder, first.id); await preparation.cancel(f.folder, queued.id);
    const review = await f.review();
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
    expect(f.state.deleted).toEqual([]);
    release(); await Promise.all(jobs);
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(200);
    expect(await stat(f.folder).catch(() => null)).toBeNull();
  } finally { release(); await Promise.allSettled(jobs); }
});

test("background corpus classification blocks deletion through cancellation and final persistence", async () => {
  const f = await fixture();
  await writeFile(join(f.folder, "evidence.txt"), "Evidence");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const jobs: Promise<void>[] = [];
  const corpus = new CorpusService({
    selection: async () => ({ providerId: "test", model: "test" }),
    extract: async () => ({ text: "Evidence", pages: [{ page: 1, text: "Evidence" }], complete: true, extraction: "native", hash: "source" }),
    infer: async () => { entered(); await held; return { model: "test", answers: { answer: { type: "noul", noul: 1 } } }; },
  }, run => { const job = withProjectMutation(f.config, run); jobs.push(job); return job; });
  try {
    const job = await corpus.query(f.config.workspaces[0], { paths: ["evidence.txt"], question: "Does this contain evidence?", waitSeconds: 0 });
    await started;
    await corpus.query(f.config.workspaces[0], { jobId: job.jobId, cancel: true, waitSeconds: 0 });
    const review = await f.review();
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
    release(); await Promise.all(jobs);
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(200);
    expect(await stat(f.folder).catch(() => null)).toBeNull();
  } finally { release(); await Promise.allSettled(jobs); await corpus.stop(); }
});


test("a detached tabular review blocks deletion until results and history have finished saving", async () => {
  const f = await fixture(), workspace = f.config.workspaces[0];
  await writeFile(join(f.folder, "evidence.md"), "Assignment is permitted.");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const jobs: Promise<void>[] = [];
  const service = new ReviewService({
    models: async () => ({ settings: { mode: "llm", llm: { providerId: "test", model: "test" }, jev: null }, allowedKinds: ["yes_no"], errors: [],
      models: [{ backend: "llm", providerId: "test", model: "test", name: "Test", providerName: "Test" }] }),
    execute: async (_workspace, _review, question, evidence) => {
      entered(); await held;
      return { value: "Yes", reason: "", citations: [], confidence: null, evidence: "uncited", backend: "llm", providerId: "test", model: "test", requestedModel: "test",
        sourceHash: evidence.hash, prompt: question, completedAt: Date.now(), chunks: [] };
    },
  }, new DocumentPreparation(new OcrManager(join(f.root, "ocr"))), new ReviewDefaults(join(f.root, "defaults")), undefined,
  run => { const job = withProjectMutation(f.config, run); jobs.push(job); return job; });
  try {
    const saved = await service.create(workspace, { requestId: crypto.randomUUID(), name: "Review", files: ["evidence.md"],
      columns: [{ key: "assignment", label: "Assignment", question: "Is assignment permitted?", kind: "yes_no", options: [], hint: "" }] });
    await service.start(workspace, saved.id, { revision: saved.revision });
    await started;
    const review = await f.review();
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(409);
    expect(f.state.deleted).toEqual([]);
    release(); await Promise.all(jobs);
    expect((await f.request("/workspaces/source/delete-project", "POST", { token: review.token })).status).toBe(200);
    expect(await stat(f.folder).catch(() => null)).toBeNull();
  } finally { release(); await Promise.allSettled(jobs); await service.stop(); }
});
