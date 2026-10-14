import { z } from "zod";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LegalWorkExtensionsPreview } from "./legalwork-extensions-preview.js";

const roots: string[] = [];
let originalFetch: typeof globalThis.fetch | null = null;
let previousDiscovery: string | undefined;

afterEach(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
  if (previousDiscovery === undefined) delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
  else process.env.LEGALWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

/** Point the plugin at a fake UI bridge that serves one snapshot payload. */
async function withBridge(snapshot: unknown, execute?: (body: unknown) => unknown) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-ui-bridge-"));
  roots.push(root);
  const discovery = join(root, "legalwork-ui-control.json");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://ui.test", token: "t" }), "utf8");
  previousDiscovery = process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
  process.env.LEGALWORK_UI_CONTROL_DISCOVERY = discovery;

  originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/snapshot")) return Response.json(snapshot);
      if (url.endsWith("/execute") && execute) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        return Response.json(execute(body));
      }
      return new Response("Not found", { status: 404 });
    },
    { preconnect: originalFetch.preconnect },
  );
}

describe("legalwork_ui_snapshot session identity", () => {
  // Regression: asked "give me the session id of this convo", the agent found
  // no tool carrying it, navigated to the session view, and read an id out of
  // the resulting route — a DIFFERENT session than the one it was running in —
  // then stated it as fact. The engine had the real id in the tool context all
  // along, so the snapshot now carries it.
  test("reports the running session id, not the id in the route", async () => {
    await withBridge({
      ok: true,
      route: "/workspace/ws_84ca3ac552ab/session/ses_someOtherSessionOnScreen",
      status: "ready",
    });

    const plugin = await LegalWorkExtensionsPreview();
    const raw = await plugin.tool.legalwork_ui_snapshot.execute(
      {},
      { sessionID: "ses_theRunningSession", agent: "legalwork", directory: "/Users/lawyer/Matter" },
    );
    const parsed = JSON.parse(raw) as {
      route: string;
      session: { id: string; agent: string; directory: string };
    };

    expect(parsed.session.id).toBe("ses_theRunningSession");
    expect(parsed.session.agent).toBe("legalwork");
    expect(parsed.session.directory).toBe("/Users/lawyer/Matter");
    // The route still reflects the screen, and must stay distinguishable from
    // the running session — that difference is the whole point.
    expect(parsed.route).toContain("ses_someOtherSessionOnScreen");
    expect(parsed.session.id).not.toBe("ses_someOtherSessionOnScreen");
  });

  test("still carries session identity when the bridge reports an error", async () => {
    await withBridge({ ok: false, error: "LegalWork UI bridge not available." });

    const plugin = await LegalWorkExtensionsPreview();
    const raw = await plugin.tool.legalwork_ui_snapshot.execute({}, { sessionID: "ses_abc" });
    const parsed = JSON.parse(raw) as { ok: boolean; session: { id: string } };

    expect(parsed.ok).toBe(false);
    expect(parsed.session.id).toBe("ses_abc");
  });

  test("the tool description sends the agent to session.id rather than the route", async () => {
    const plugin = await LegalWorkExtensionsPreview();
    expect(plugin.tool.legalwork_ui_snapshot.description).toContain("session.id");
    expect(plugin.tool.legalwork_ui_snapshot.description).toContain("never from `route`");
  });
});

describe("in-app Word document routing", () => {
  const activeDocumentSnapshot = {
    ok: true,
    route: "/workspace/ws_matter/session/ses_open",
    activeSurface: {
      id: "ses_open:file:compensation-memo.docx",
      kind: "document",
      format: "docx",
      sessionId: "ses_open",
      workspaceId: "ws_matter",
      name: "compensation-memo.docx",
      path: "compensation-memo.docx",
      editable: true,
      agentEditsTracked: true,
    },
    actions: [],
  };

  test("injects the active document and live tracked-edit route for the matching session", async () => {
    await withBridge(activeDocumentSnapshot);
    const plugin = await LegalWorkExtensionsPreview();
    const output: { system: string[] } = { system: [] };

    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_open" }, output);

    const system = output.system.join("\n");
    expect(system).toContain("compensation-memo.docx");
    expect(system).toContain("operation suggest_change");
    expect(system).toContain("operation reject_changes");
    expect(system).toContain("save automatically");
    expect(system).toContain("Do not search LegalMemory merely");
  });

  test("does not claim a document open in a different session", async () => {
    await withBridge(activeDocumentSnapshot);
    const plugin = await LegalWorkExtensionsPreview();
    const output: { system: string[] } = { system: [] };

    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_other" }, output);

    expect(output.system.join("\n")).not.toContain("The active right-hand document");
  });

  test("blocks Bash from reading the document that is open in the editor", async () => {
    await withBridge(activeDocumentSnapshot);
    const plugin = await LegalWorkExtensionsPreview();

    await expect(plugin["tool.execute.before"](
      { tool: "bash", sessionID: "ses_open", callID: "call_1" },
      { args: { command: 'node docx-agent.mjs inspect "compensation-memo.docx"' } },
    )).rejects.toThrow("use inapp_docx");
  });

  test("routes in-app document tools to the matching session-scoped editor action", async () => {
    let request: unknown;
    await withBridge(activeDocumentSnapshot, (body) => {
      request = body;
      return {
        ok: true,
        actionId: "document.agent_tool",
        result: { ok: true, data: "[P1] Compensation", saved: false },
      };
    });
    const plugin = await LegalWorkExtensionsPreview();

    const raw = await plugin.tool.inapp_docx.execute({ operation: "read_document", args: { fromIndex: 0, toIndex: 5 } },
      { sessionID: "ses_open" },
    );

    expect(request).toEqual({
      actionId: "document.agent_tool",
      args: {
        sessionId: "ses_open",
        toolName: "read_document",
        args: { fromIndex: 0, toIndex: 5 },
      },
    });
    expect(JSON.parse(raw)).toMatchObject({ ok: true, result: { data: "[P1] Compensation" } });
  });

  test("routes targeted tracked-change rejection to the live editor", async () => {
    let request: unknown;
    await withBridge(activeDocumentSnapshot, (body) => {
      request = body;
      return { ok: true, actionId: "document.agent_tool", result: { ok: true, saved: true } };
    });
    const plugin = await LegalWorkExtensionsPreview();

    await plugin.tool.inapp_docx.execute({ operation: "reject_changes", args: { changeIds: [11, 12] } },
      { sessionID: "ses_open" },
    );

    expect(request).toEqual({
      actionId: "document.agent_tool",
      args: {
        sessionId: "ses_open",
        toolName: "reject_changes",
        args: { changeIds: [11, 12] },
      },
    });
  });
});

describe("in-app Office sidebar routing", () => {
  const surface = { kind: "document", format: "xlsx", sessionId: "ses_office", name: "Budget.xlsx", path: "matter/Budget.xlsx", editable: true, agentEditsTracked: false };
  const snapshot = { activeSurface: surface, openFiles: [
    { sessionId: "ses_office", name: "Budget.xlsx", path: surface.path, active: true },
    { sessionId: "ses_office", name: "Review.pptx", path: "matter/Review.pptx", active: false },
    { sessionId: "ses_other", name: "Private.xlsx", path: "Private.xlsx", active: true },
  ] };
  test("reports all open files for this session and injects the live Excel route", async () => {
    await withBridge(snapshot);
    const plugin = await LegalWorkExtensionsPreview();
    const result = JSON.parse(await plugin.tool.inapp_documents_list.execute({}, { sessionID: "ses_office" }));
    expect(result.files).toHaveLength(2);
    expect(result.files[1].active).toBe(false);
    const output: { system: string[] } = { system: [] };
    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_office" }, output);
    expect(output.system.join("\n")).toContain("inapp_xlsx_write");
    expect(output.system.join("\n")).toContain("matter/Review.pptx");
    expect(output.system.join("\n")).not.toContain("Private.xlsx");
    expect(output.system.join("\n")).toContain("not tracked changes");
  });
  test("routes writes with exact file and engine session identity", async () => {
    let called: unknown;
    await withBridge(snapshot, (body) => { called = body; return { ok: true, result: { saved: true } }; });
    const plugin = await LegalWorkExtensionsPreview();
    const args = { path: surface.path, sheet: "Budget", range: "B4", values: [[18]] };
    await plugin.tool.inapp_xlsx_write.execute(args, { sessionID: "ses_office" });
    expect(called).toEqual({ actionId: "office.agent_tool", args: { sessionId: "ses_office", path: surface.path, toolName: "write", args } });
  });
  test("rejects stale paths, wrong formats and cross-session access before dispatch", async () => {
    let calls = 0;
    await withBridge(snapshot, () => { calls++; return { ok: true }; });
    const plugin = await LegalWorkExtensionsPreview();
    for (const [path, sessionID] of [[surface.path, "ses_other"], ["switched.xlsx", "ses_office"]]) {
      const result = JSON.parse(await plugin.tool.inapp_xlsx_read.execute({ path }, { sessionID }));
      expect(result.ok).toBe(false);
    }
    const pptxResult = await plugin.tool.inapp_pptx_read.execute({ path: surface.path }, { sessionID: "ses_office" });
    expect(typeof pptxResult === "string" && JSON.parse(pptxResult).ok).toBe(false);
    expect(calls).toBe(0);
    expect(JSON.parse(await plugin.tool.inapp_documents_list.execute({}, {})).files).toEqual([]);
  });
  test("selects open tabs and retries save without repeating mutations", async () => {
    const calls: unknown[] = [];
    await withBridge(snapshot, (body) => { calls.push(body); return { ok: true }; });
    const plugin = await LegalWorkExtensionsPreview();
    await plugin.tool.inapp_documents_select.execute({ path: surface.path }, { sessionID: "ses_office" });
    await plugin.tool.inapp_office_save.execute({ path: surface.path }, { sessionID: "ses_office" });
    expect(calls).toEqual([
      { actionId: "documents.select_open", args: { sessionId: "ses_office", path: surface.path } },
      { actionId: "office.agent_tool", args: { sessionId: "ses_office", path: surface.path, toolName: "save", args: { path: surface.path } } },
    ]);
  });
  test("blocks file rewrites of the live Office draft but allows unrelated work", async () => {
    await withBridge(snapshot);
    const plugin = await LegalWorkExtensionsPreview();
    await expect(plugin["tool.execute.before"]({ tool: "bash", sessionID: "ses_office", callID: "1" }, { args: { command: "rewrite matter/Budget.xlsx" } })).rejects.toThrow("inapp_xlsx_*");
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "ses_office", callID: "2" }, { args: { command: "read other.xlsx" } });
  });
  test("routes presentation replacements to the live editor", async () => {
    const pptx = { ...surface, format: "pptx", path: "Review.pptx" };
    let call: unknown;
    await withBridge({ activeSurface: pptx }, (body) => { call = body; return { ok: true }; });
    const plugin = await LegalWorkExtensionsPreview();
    const args = { path: pptx.path, slideIndex: 0, elementId: "title", search: "Draft", replaceWith: "Approved" };
    await plugin.tool.inapp_pptx_replace_text.execute(args, { sessionID: "ses_office" });
    expect(call).toEqual({ actionId: "office.agent_tool", args: { sessionId: "ses_office", path: pptx.path, toolName: "replace_text", args } });
  });
});

test("live Office tool schemas are serializable for model tool calling", async () => {
  const plugin = await LegalWorkExtensionsPreview();
  for (const [name, tool] of Object.entries(plugin.tool)) {
    if (name.startsWith("inapp_")) expect(() => z.toJSONSchema(z.object(tool.args))).not.toThrow();
  }
});

describe("in-app Markdown routing", () => {
  test("reads and edits the live draft with exact session/path routing", async () => {
    const surface = { kind: "document", format: "md", sessionId: "ses_md", name: "Brief.md", path: "matter/Brief.md", editable: true, agentEditsTracked: false };
    const calls: unknown[] = [];
    await withBridge({ activeSurface: surface }, (body) => { calls.push(body); return { ok: true }; });
    const plugin = await LegalWorkExtensionsPreview();
    const output: { system: string[] } = { system: [] };
    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_md" }, output);
    expect(output.system.join("\n")).toContain("inapp_md_replace_text");
    const args = { path: surface.path, search: "draft", replacement: "final" };
    await plugin.tool.inapp_md_replace_text.execute(args, { sessionID: "ses_md" });
    expect(calls).toEqual([{ actionId: "markdown.agent_tool", args: { sessionId: "ses_md", path: surface.path, toolName: "replace_text", args } }]);
    expect(JSON.parse(await plugin.tool.inapp_md_read.execute({ path: surface.path }, { sessionID: "other" })).ok).toBe(false);
    expect(JSON.parse(await plugin.tool.inapp_md_read.execute({ path: "wrong.md" }, { sessionID: "ses_md" })).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

test("opens workspace and connected files in the engine session, then exposes live editing", async () => {
  const calls: unknown[] = [];
  await withBridge({}, (body) => { calls.push(body); return { ok: true, status: "opening" }; });
  const plugin = await LegalWorkExtensionsPreview();
  expect(JSON.parse(await plugin.tool.inapp_documents_open.execute({ path: "draft.md" }, {})).ok).toBe(false);
  expect(calls).toEqual([]);
  await plugin.tool.inapp_documents_open.execute({ path: "draft.md" }, { sessionID: "ses_this" });
  await plugin.tool.inapp_documents_open.execute({ path: "Matter/draft.docx", connection_id: "team:s3" }, { sessionID: "ses_this" });
  await plugin.tool.inapp_documents_open.execute({ path: "Templates/Pitch.pptx", connection_id: "team:s3", copy_to: "Client pitch.pptx" }, { sessionID: "ses_this" });
  expect(calls).toEqual([
    { actionId: "documents.open", args: { sessionId: "ses_this", path: "draft.md" } },
    { actionId: "documents.open", args: { sessionId: "ses_this", path: "Matter/draft.docx", connectionId: "team:s3" } },
    { actionId: "documents.open", args: { sessionId: "ses_this", path: "Templates/Pitch.pptx", connectionId: "team:s3", copyTo: "Client pitch.pptx" } },
  ]);
  const output: { system: string[] } = { system: [] };
  await plugin["experimental.chat.system.transform"]({ sessionID: "ses_this" }, output);
  expect(output.system.join("\n")).toContain("inapp_documents_open");
  expect(output.system.join("\n")).toContain("inapp_md_*");
  expect(output.system.join("\n")).toContain("An empty inapp_documents_list means you need to open the file");
});

describe("PowerPoint visual feedback", () => {
  const snapshot = { activeSurface: { kind: "document", format: "pptx", sessionId: "ses_slides", name: "Deck.pptx", path: "Deck.pptx", editable: true } };
  test("only explicit previews send a slide image attachment", async () => {
    let request: unknown;
    await withBridge(snapshot, (body) => {
      request = body;
      return { ok: true, result: { ok: true, saved: true, data: { slideIndex: 2, layout: { warnings: [{ kind: "text_overlap", elementIds: ["title", "body"] }] }, preview: { available: true, width: 1280, height: 720, dataUrl: "data:image/png;base64,cHJldmlldw==" } } } };
    });
    const plugin = await LegalWorkExtensionsPreview();
    const result = await plugin.tool.inapp_pptx_preview.execute({ path: "Deck.pptx", slideIndex: 2 }, { sessionID: "ses_slides" });
    expect(request).toMatchObject({ actionId: "office.agent_tool", args: { toolName: "preview", args: { slideIndex: 2 } } });
    const edits = [
      await plugin.tool.inapp_pptx_read.execute({ path: "Deck.pptx", slideIndex: 2 }, { sessionID: "ses_slides" }),
      await plugin.tool.inapp_pptx_replace_text.execute({ path: "Deck.pptx", slideIndex: 2, elementId: "title", search: "Draft", replaceWith: "Final" }, { sessionID: "ses_slides" }),
      await plugin.tool.inapp_pptx_update_layout.execute({ path: "Deck.pptx", slideIndex: 2, elementId: "title", height: 120, fontSize: 28 }, { sessionID: "ses_slides" }),
    ];
    for (const edit of edits) {
      if (typeof edit !== "string") throw new Error("Routine calls must not return attachments");
      expect(edit).not.toContain("base64");
      expect(JSON.parse(edit)).toMatchObject({ result: { data: { layout: { warnings: [{ kind: "text_overlap" }] } } } });
      expect(JSON.parse(edit).result.data.preview).toBeUndefined();
    }
    const instructions: { system: string[] } = { system: [] };
    await plugin["experimental.chat.system.transform"]({ sessionID: "ses_slides" }, instructions);
    expect(instructions.system.join("\n")).toContain("Do not request a preview after every read or individual edit");
    if (typeof result === "string") throw new Error("Expected a visual tool result");
    expect(result.attachments).toEqual([{ type: "file", mime: "image/png", url: "data:image/png;base64,cHJldmlldw==", filename: "slide-3.png" }]);
    expect(result.output).not.toContain("base64");
    expect(JSON.parse(result.output)).toMatchObject({ result: { saved: true, data: { layout: { warnings: [{ kind: "text_overlap" }] }, preview: { attached: true, width: 1280 } } } });
  });
  test("retains saved edits and reports unavailable preview honestly", async () => {
    await withBridge(snapshot, () => ({ ok: true, result: { ok: true, saved: true, data: { slideIndex: 0, preview: { available: false, error: "Canvas unavailable" } } } }));
    const plugin = await LegalWorkExtensionsPreview();
    const result = await plugin.tool.inapp_pptx_replace_text.execute({ path: "Deck.pptx", slideIndex: 0, elementId: "title", search: "Draft", replaceWith: "Final" }, { sessionID: "ses_slides" });
    expect(typeof result).toBe("string");
    if (typeof result !== "string") throw new Error("Unexpected attachment");
    expect(JSON.parse(result)).toMatchObject({ result: { saved: true, data: { preview: { available: false } } } });
    const wrongSession = await plugin.tool.inapp_pptx_preview.execute({ path: "Deck.pptx" }, { sessionID: "ses_other" });
    expect(typeof wrongSession === "string" && JSON.parse(wrongSession).ok).toBe(false);
  });
});

describe("native Word structure agent tools", () => {
  test("advertises one Word tool and discovers operation syntax without opening a document", async () => {
    let dispatches = 0;
    await withBridge({}, () => { dispatches++; return { ok: true }; });
    const plugin = await LegalWorkExtensionsPreview();
    expect(Object.keys(plugin.tool).filter((name) => name.startsWith("inapp_docx"))).toEqual(["inapp_docx"]);
    expect(Object.keys(plugin.tool.inapp_docx.args)).toEqual(["operation", "args"]);
    const list = JSON.parse(await plugin.tool.inapp_docx.execute({ operation: "help" }, {}));
    expect(list).toMatchObject({ tool: "inapp_docx", operations: expect.arrayContaining([{ operation: "insert_cross_reference", description: expect.any(String) }, { operation: "create_comparison_copy", description: expect.any(String) }]) });
    expect(list).not.toHaveProperty("argsSchema");
    const help = JSON.parse(await plugin.tool.inapp_docx.execute({ operation: "help", args: { operation: "insert_cross_reference" } }, {}));
    expect(help).toMatchObject({ operation: "insert_cross_reference", argsSchema: { type: "object", required: expect.arrayContaining(["documentId", "draftRevision", "paraId", "search", "kind"]), properties: { kind: { enum: ["number", "text", "page"] } } } });
    expect(dispatches).toBe(0);
    await expect(plugin.tool.inapp_docx.execute({ operation: "unknown_method" }, {})).rejects.toThrow("Use operation help");
    await expect(plugin.tool.inapp_docx.execute({ operation: "help", args: { operation: "unknown_method" } }, {})).rejects.toThrow("Use operation help");
  });

  test("routes native reference creation with identity and preserves stale/protection errors", async () => {
    let call: unknown;
    await withBridge({}, (body) => { call = body; return { ok: true, result: { ok: false, error: "Read the draft again" } }; });
    const plugin = await LegalWorkExtensionsPreview();
    const args = { documentId: "doc-1", draftRevision: 3, paraId: "P1", targetParaId: "P8", kind: "number", search: "8" };
    const raw = await plugin.tool.inapp_docx.execute({ operation: "insert_cross_reference", args: args }, { sessionID: "ses_word" });
    expect(call).toEqual({ actionId: "document.agent_tool", args: { sessionId: "ses_word", toolName: "insert_cross_reference", args } });
    expect(JSON.parse(raw).result).toEqual({ ok: false, error: "Read the draft again" });
    await expect(plugin.tool.inapp_docx.execute({ operation: "insert_cross_reference", args: { ...args, draftRevision: -1 } }, { sessionID: "ses_word" })).rejects.toThrow();
    await expect(plugin.tool.inapp_docx.execute({ operation: "insert_cross_reference", args: { paraId: "P1", kind: "number", search: "8" } }, { sessionID: "ses_word" })).rejects.toThrow();
  });

  test("discovers and routes formatting inside the single Word tool with validated units and fresh identity", async () => {
    const calls: unknown[] = [];
    await withBridge({}, (body) => { calls.push(body); return { ok: true, result: { ok: true, saved: true } }; });
    const plugin = await LegalWorkExtensionsPreview();
    const help = JSON.parse(await plugin.tool.inapp_docx.execute({ operation: "help", args: { operation: "apply_formatting" } }, {}));
    expect(help.argsSchema.required).toEqual(expect.arrayContaining(["documentId", "draftRevision", "paraId"]));
    expect(help.argsSchema.properties.marks.properties.fontSize.description).toContain("Points");
    const args = { documentId: "doc-1", draftRevision: 3, paraId: "P1", search: "Clause", marks: { bold: false, fontSize: 10.5 }, paragraph: { alignment: "both", spaceAfter: 6 } };
    await plugin.tool.inapp_docx.execute({ operation: "apply_formatting", args }, { sessionID: "ses_word" });
    await plugin.tool.inapp_docx.execute({ operation: "read_formatting", args: { paraId: "P1", includeStyles: true } }, { sessionID: "ses_word" });
    expect(calls).toEqual([
      { actionId: "document.agent_tool", args: { sessionId: "ses_word", toolName: "apply_formatting", args } },
      { actionId: "document.agent_tool", args: { sessionId: "ses_word", toolName: "read_formatting", args: { paraId: "P1", includeStyles: true } } },
    ]);
    await expect(plugin.tool.inapp_docx.execute({ operation: "apply_formatting", args: { ...args, marks: { fontSize: -1 } } }, {})).rejects.toThrow();
    await expect(plugin.tool.inapp_docx.execute({ operation: "apply_formatting", args: { ...args, paragraph: { typo: true } } }, {})).rejects.toThrow();
    await expect(plugin.tool.inapp_docx.execute({ operation: "apply_formatting", args: { paraId: "P1", marks: { bold: true } } }, {})).rejects.toThrow();
    await expect(plugin.tool.inapp_docx.execute({ operation: "read_formatting", args: { limit: 500 } }, {})).rejects.toThrow();
    expect(calls.length).toBe(2);
  });

  test("clean-copy tools write only a new workspace file and hide the binary payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "word-agent-copy-")); roots.push(root);
    const bytes = Buffer.from("detached native DOCX test bytes");
    await withBridge({}, () => ({ ok: true, result: { ok: true, data: { bufferBase64: bytes.toString("base64"), findings: [], sourceChanged: false } } }));
    const plugin = await LegalWorkExtensionsPreview();
    const args = { documentId: "doc-1", draftRevision: 4, fileName: "Outgoing.docx", categories: ["comments"] };
    const raw = await plugin.tool.inapp_docx.execute({ operation: "create_clean_copy", args: args }, { sessionID: "ses_word", directory: root });
    expect(await readFile(join(root, "Outgoing.docx"))).toEqual(bytes);
    expect(JSON.parse(raw).result.data).toEqual({ findings: [], sourceChanged: false, path: join(await realpath(root), "Outgoing.docx") });
    expect(raw).not.toContain("bufferBase64");
    await expect(plugin.tool.inapp_docx.execute({ operation: "create_clean_copy", args: args }, { sessionID: "ses_word", directory: root })).rejects.toThrow("EEXIST");
    await expect(plugin.tool.inapp_docx.execute({ operation: "create_clean_copy", args: { ...args, fileName: "../Outside.docx" } }, { sessionID: "ses_word", directory: root })).rejects.toThrow();
  });

  test("comparison tools read returned workspace drafts and reject symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "word-agent-compare-")); roots.push(root);
    const outside = await mkdtemp(join(tmpdir(), "word-agent-outside-")); roots.push(outside);
    await writeFile(join(root, "Returned.docx"), "returned document bytes");
    await writeFile(join(outside, "Secret.docx"), "outside");
    await symlink(join(outside, "Secret.docx"), join(root, "Escape.docx"));
    let request: unknown;
    await withBridge({}, (body) => { request = body; return { ok: true, result: { ok: true, data: { bufferBase64: Buffer.from("comparison bytes").toString("base64"), changes: [{ author: "Counsel" }] } } }; });
    const plugin = await LegalWorkExtensionsPreview();
    const args = { documentId: "doc-1", draftRevision: 2, fileName: "Comparison.docx", versions: [{ path: "Returned.docx", author: "Counsel" }] };
    await plugin.tool.inapp_docx.execute({ operation: "create_comparison_copy", args: args }, { sessionID: "ses_word", directory: root });
    expect(request).toMatchObject({ actionId: "document.agent_tool", args: { sessionId: "ses_word", toolName: "create_comparison_copy", args: { versions: [{ base64: Buffer.from("returned document bytes").toString("base64"), author: "Counsel" }] } } });
    await expect(plugin.tool.inapp_docx.execute({ operation: "create_comparison_copy", args: { ...args, fileName: "EscapeComparison.docx", versions: [{ path: "Escape.docx", author: "Counsel" }] } }, { sessionID: "ses_word", directory: root })).rejects.toThrow("inside the active workspace");
  });
});
