import { describe, expect, test } from "bun:test";
import { createDocumentRuntime } from "../src/react-app/domains/session/artifacts/document-runtime-store";

function fixture() {
  const runtime = createDocumentRuntime(() => ({ className: "" }));
  const clients = { a: { baseUrl: "http://a" }, b: { baseUrl: "http://b" } };
  const projects = { left: "a", right: "a", elsewhere: "b" };
  runtime.setResolver(session => {
    const project = projects[session];
    if (!project) throw new Error("Unknown task");
    return { projectId: project, workspaceId: project, workspaceRoot: `/${project}`, client: clients[project] };
  });
  function document(project, path, execute = async () => ({ ok: true, path })) {
    const entry = runtime.ensure({ client: clients[project], workspaceId: project, workspaceRoot: `/${project}`, sessionId: `workspace:${project}`,
      tab: { id: `file:${path}`, type: "artifact", value: path, label: path, preview: "word" }, onClose() {} });
    entry.registration = { surface: { id: path, path, name: path, kind: "document", format: "docx", workspaceId: project, editable: true }, ready: () => true, dirty: () => false,
      action: { id: "document.agent_tool", execute } };
    return entry;
  }
  return { runtime, document, clients };
}

describe("task document runtime", () => {
  test("legacy attachment copies retain their format without a visible document pane", async () => {
    const { runtime, document, clients } = fixture();
    const source = ".legalwork/attachments/fixture/Contract.docx___Matter_A";
    const copied = [];
    clients.a.copyWorkspaceFile = async (...args) => { copied.push(args); };
    clients.a.statWorkspaceFile = async (_workspace, path) => ({ path, exists: true, kind: "file", size: 100, updatedAt: 1 });
    const output = document("a", "Revised.docx");
    expect(await runtime.open({ sessionId: "left", path: source, copyTo: "Revised.docx" })).toMatchObject({ ok: true, copied: true, liveEditing: true, path: "Revised.docx" });
    expect(copied).toEqual([["a", source, "Revised.docx"]]);
    expect(output.destinations.size).toBe(0);
    await expect(runtime.open({ sessionId: "left", path: source, copyTo: "Revised.xlsx" })).rejects.toThrow("same file extension");
  });

  test("two tasks select and edit separate documents without visible destinations", async () => {
    const { runtime, document } = fixture();
    const one = document("a", "one.docx"), two = document("a", "two.docx");
    await runtime.select({ sessionId: "left", path: "one.docx" });
    await runtime.select({ sessionId: "right", path: "two.docx" });
    expect(await runtime.execute("document.agent_tool", { sessionId: "left" })).toEqual({ ok: true, path: "one.docx" });
    expect(await runtime.execute("document.agent_tool", { sessionId: "right" })).toEqual({ ok: true, path: "two.docx" });
    expect(one.destinations.size + two.destinations.size).toBe(0);
    expect((await runtime.list({ sessionId: "left" })).activeSurface.path).toBe("one.docx");
    expect((await runtime.list({ sessionId: "right" })).activeSurface.path).toBe("two.docx");
  });

  test("same filenames in other projects cannot redirect a task", async () => {
    const { runtime, document } = fixture();
    document("a", "contract.docx", async () => "a");
    document("b", "contract.docx", async () => "b");
    await runtime.select({ sessionId: "left", path: "contract.docx" });
    await runtime.select({ sessionId: "elsewhere", path: "contract.docx" });
    expect(await runtime.execute("document.agent_tool", { sessionId: "left" })).toBe("a");
    expect(await runtime.execute("document.agent_tool", { sessionId: "elsewhere" })).toBe("b");
    document("b", "private.docx");
    await expect(runtime.execute("document.agent_tool", { sessionId: "left", path: "private.docx" })).rejects.toThrow("No document");
    await expect(runtime.execute("document.agent_tool", { sessionId: "unknown" })).rejects.toThrow("Unknown task");
    expect((await runtime.list({ sessionId: "left" })).openFiles.map(file => file.path)).toEqual(["contract.docx"]);
  });

  test("user tab selection and detachment cannot redirect the task after its first read", async () => {
    const { runtime, document } = fixture();
    const one = document("a", "one.docx"), two = document("a", "two.docx");
    one.destinations.set({}, true);
    expect(await runtime.execute("document.agent_tool", { sessionId: "left" })).toEqual({ ok: true, path: "one.docx" });
    one.destinations.clear(); two.destinations.set({}, true);
    expect(await runtime.execute("document.agent_tool", { sessionId: "left" })).toEqual({ ok: true, path: "one.docx" });
    expect(runtime.ensure(one.props)).toBe(one);
  });

  test("parallel calls on one draft wait for its save, without blocking other files", async () => {
    const { runtime, document } = fixture();
    const events = [];
    let finish;
    const saving = new Promise(resolve => { finish = resolve; });
    document("a", "one.docx", async args => { events.push(args.toolName); if (args.toolName === "edit") await saving; return args.toolName; });
    document("a", "two.docx", async () => { events.push("other"); return "other"; });
    await runtime.select({ sessionId: "left", path: "one.docx" });
    await runtime.select({ sessionId: "right", path: "two.docx" });
    const edit = runtime.execute("document.agent_tool", { sessionId: "left", toolName: "edit" });
    const read = runtime.execute("document.agent_tool", { sessionId: "left", toolName: "read" });
    expect(await runtime.execute("document.agent_tool", { sessionId: "right" })).toBe("other");
    expect(events).toEqual(["edit", "other"]);
    // Capture before queuing, even if another operation changes task selection.
    await runtime.select({ sessionId: "left", path: "two.docx" });
    finish(); await Promise.all([edit, read]);
    expect(events).toEqual(["edit", "other", "read"]);
  });

  test("a rejected edit does not poison the document queue", async () => {
    const { runtime, document } = fixture();
    document("a", "one.docx", async args => { if (args.toolName === "bad") throw new Error("bad range"); return "readable"; });
    await runtime.select({ sessionId: "left", path: "one.docx" });
    await expect(runtime.execute("document.agent_tool", { sessionId: "left", toolName: "bad" })).rejects.toThrow("bad range");
    expect(await runtime.execute("document.agent_tool", { sessionId: "left", toolName: "read" })).toBe("readable");
    await expect(runtime.execute("office.agent_tool", { sessionId: "left", format: "xlsx" })).rejects.toThrow("different format");
  });
});

test("closed clean editors are released after the task finishes; unsaved drafts survive", async () => {
  const { runtime, document } = fixture();
  const clean = document("a", "clean.docx"), dirty = document("a", "dirty.docx");
  dirty.registration.dirty = () => true;
  await runtime.select({ sessionId: "left", path: "clean.docx" });
  await runtime.select({ sessionId: "right", path: "dirty.docx" });
  runtime.prune();
  expect(runtime.entries.has(clean.key)).toBe(true);
  runtime.releaseTask("left"); runtime.releaseTask("right");
  expect(runtime.entries.has(clean.key)).toBe(false);
  expect(runtime.entries.has(dirty.key)).toBe(true);
});

test("uncached tasks resolve their project without mounting a route", async () => {
  let lookups = 0;
  const project = { projectId: "p", workspaceId: "p", workspaceRoot: "/p", client: { baseUrl: "http://p" } };
  const runtime = createDocumentRuntime(() => ({ className: "" }), async () => { lookups++; return project; });
  expect(await runtime.getProject("background")).toBe(project);
  expect(await runtime.list({ sessionId: "background" })).toEqual({ openFiles: [], surfaces: [], activeSurface: null });
  expect(lookups).toBe(1);
});

test("each chat retains all its working documents until completion and dismissing a mini tab never cancels an edit", async () => {
  const { runtime, document } = fixture();
  const one = document("a", "one.docx"), two = document("a", "two.docx");
  await runtime.select({ sessionId: "left", path: "one.docx" });
  await runtime.select({ sessionId: "left", path: "two.docx" });
  await runtime.select({ sessionId: "right", path: "one.docx" });
  runtime.prune();
  expect(runtime.entries.size).toBe(2);
  expect([...one.tasks]).toEqual(["left", "right"]);
  expect([...two.tasks]).toEqual(["left"]);
  runtime.dismiss(one, "left");
  expect(one.dismissed.has("left")).toBe(true);
  expect(one.dismissed.has("right")).toBe(false);
  expect(await runtime.execute("document.agent_tool", { sessionId: "left", path: "one.docx" })).toEqual({ ok: true, path: "one.docx" });
  expect(one.dismissed.has("left")).toBe(false);
  runtime.releaseTask("left");
  expect(runtime.entries.has(two.key)).toBe(false);
  expect([...one.tasks]).toEqual(["right"]);
  expect(await runtime.execute("document.agent_tool", { sessionId: "right" })).toEqual({ ok: true, path: "one.docx" });
  runtime.releaseTask("right");
  expect(runtime.entries.size).toBe(0);
});

test("promotion and closing the full document view retain the agent's exact editor", async () => {
  const { runtime, document } = fixture();
  const entry = document("a", "one.docx");
  await runtime.select({ sessionId: "left", path: "one.docx" });
  const destination = {};
  entry.destinations.set(destination, true);
  runtime.prune();
  expect(runtime.entries.get(entry.key)).toBe(entry);
  entry.destinations.delete(destination);
  runtime.prune();
  expect(runtime.entries.get(entry.key)).toBe(entry);
  expect(await runtime.execute("document.agent_tool", { sessionId: "left" })).toEqual({ ok: true, path: "one.docx" });
  entry.destinations.set(destination, true);
  runtime.releaseTask("left");
  expect(runtime.entries.get(entry.key)).toBe(entry);
  expect(entry.tasks.size).toBe(0);
});
