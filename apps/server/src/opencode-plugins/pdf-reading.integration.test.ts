import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { PdfReader } from "../pdf-reader.js";
import { OcrService } from "../ocr/service.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary)("native read retains PDF routing across concurrent title requests, OCR and read permissions", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "pdf-read-engine-")));
  const project = join(root, "project"); await mkdir(project);
  const native = await PDFDocument.create(); native.addPage().drawText("Native contract marker");
  const nativeBytes = await native.save();
  const scan = await PDFDocument.create(); scan.addPage(); scan.addPage();
  const scanBytes = await scan.save();
  await writeFile(join(project, "native.pdf"), nativeBytes);
  await writeFile(join(project, "scan.pdf"), scanBytes);
  await writeFile(join(project, "denied.pdf"), nativeBytes);
  await writeFile(join(project, "notes.txt"), "Ordinary file marker");
  const ocrPages: number[] = [];
  const reader = new PdfReader({ async serviceSnapshot() { return { fingerprint: "fixture", service: new OcrService([{
    info: { id: "fixture", label: "Fixture", model: "fixture", execution: "local", regions: false, languages: null, warnings: [] },
    async recognize(page) { ocrPages.push(page.pageNumber); return { text: `OCR page ${page.pageNumber} marker`, regions: [], truncated: false }; },
  }], "fixture") }; } });
  const cases = [
    { file: "native.pdf", pdf: true, pdfExpected: true, expected: "PDF supplied directly" },
    { file: "scan.pdf", pdf: true, pdfExpected: true, expected: "PDF supplied directly" },
    { file: "native.pdf", pdf: false, pdfExpected: false, expected: "Native contract marker" },
    { file: "scan.pdf", pdf: false, pdfExpected: false, expected: "OCR page 2 marker", pages: [2] },
    { file: "native.pdf", pdf: true, pdfExpected: true, expected: "OCR page 1 marker", ocr: true, pages: [1] },
    { file: "denied.pdf", pdf: true, pdfExpected: false, expected: "permission", deny: true },
    { file: "notes.txt", pdf: false, pdfExpected: false, expected: "Ordinary file marker" },
  ];
  let scenario = cases[0]!;
  const results: Array<{ wire: string; tools: string }> = [];
  const titleHooks: boolean[] = [];
  let pdfRequests = 0;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/title-hook") {
      titleHooks.push(z.object({ pdf: z.boolean() }).parse(await request.json()).pdf);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "fixture", path: project }] });
    if (url.pathname === "/workspace/fixture/pdf/read") {
      pdfRequests++;
      const input = z.object({ dataBase64: z.string(), ocr: z.boolean().optional(), pages: z.array(z.number()).optional() }).parse(await request.json());
      return Response.json(await reader.read(new Uint8Array(Buffer.from(input.dataBase64, "base64")), input, request.signal));
    }
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })), tools: z.array(z.object({ function: z.object({ name: z.string(), parameters: z.unknown() }) })).optional() }).parse(await request.json());
    const toolResults = input.messages.filter(message => message.role === "tool");
    const read = input.tools?.find(tool => tool.function.name === "read");
    if (read) {
      expect(JSON.stringify(read.function.parameters)).toContain('"ocr"');
      expect(JSON.stringify(read.function.parameters)).toContain('"pages"');
    }
    const call = read && !toolResults.length ? { name: "read", arguments: JSON.stringify({ filePath: join(project, scenario.file), ...(scenario.ocr ? { ocr: true } : {}), ...(scenario.pages ? { pages: scenario.pages } : {}) }) } : undefined;
    if (toolResults.length) results.push({ wire: JSON.stringify(input.messages), tools: JSON.stringify(toolResults) });
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: "call_pdf", type: "function", function: call }] } : { content: "Fixture complete." }) }, null)
      + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }), port = reservation.port;
  reservation.stop(true);
  const config = join(root, "config.json");
  const plugin = join(root, "controlled-title.mjs");
  await writeFile(plugin, `import { LegalWorkStorageTools } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "../../dist/opencode-plugins/legalwork-storage-tools.js")).href)};
export const ControlledTitle = async input => {
  const hooks = await LegalWorkStorageTools(input), requests = new Map();
  return { ...hooks, "chat.params": async (raw, output) => {
    let state = requests.get(raw.message.id);
    if (!state) { state = { main: Promise.withResolvers(), title: Promise.withResolvers() }; requests.set(raw.message.id, state); }
    if (raw.agent === "title") {
      await state.main.promise;
      await hooks["chat.params"](raw, output);
      await fetch(${JSON.stringify(fixture.url.origin + "/title-hook")}, { method: "POST", body: JSON.stringify({ pdf: raw.model.capabilities.input.pdf }) });
      state.title.resolve();
    } else {
      await hooks["chat.params"](raw, output);
      state.main.resolve();
      await state.title.promise;
    }
  } };
};`);
  await writeFile(config, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/pdf", small_model: "fixture/text", share: "disabled", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: {
      pdf: { name: "PDF fixture", attachment: true, modalities: { input: ["text", "image", "pdf"], output: ["text"] }, limit: { context: 100000, output: 4000 } },
      text: { name: "Text fixture", modalities: { input: ["text"], output: ["text"] }, limit: { context: 100000, output: 4000 } },
    } } }, plugin: [pathToFileURL(plugin).href],
    permission: { read: "allow" }, lsp: false, formatter: false,
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_") && !key.startsWith("LEGALWORK_"))),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: config, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_SERVER_TOKEN: "fixture",
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Startup. */ }
      if (ready || engine.exitCode !== null) break;
      await Bun.sleep(100);
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));
    for (const current of cases) {
      scenario = current;
      const before = pdfRequests, previousOcr = ocrPages.length;
      results.length = 0;
      const session = z.object({ id: z.string() }).parse(await (await fetch(base + "/session", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(scenario.deny ? { permission: [{ permission: "read", pattern: "*denied.pdf", action: "deny" }] } : {}) }) })).json());
      const response = await fetch(`${base}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "build", model: { providerID: "fixture", modelID: scenario.pdf ? "pdf" : "text" }, parts: [{ type: "text", text: "Read the fixture document." }] }), signal: AbortSignal.timeout(60000) });
      expect(response.status, await response.text()).toBe(200);
      expect(results.length, scenario.file).toBeGreaterThan(0);
      const wire = results.map(result => result.wire).join(" ");
      expect(results.map(result => result.tools).join(" ").toLowerCase(), scenario.file).toContain(scenario.expected.toLowerCase());
      expect(wire.includes("JVBERi0"), `${scenario.file}: PDF delivered`).toBe(scenario.pdfExpected);
      if (!scenario.deny && (!scenario.pdf || scenario.ocr) && scenario.file !== "notes.txt")
        expect(results.map(result => result.tools).join(" ")).toContain("page_sources");
      if (scenario.pdf && !scenario.ocr || scenario.file === "notes.txt") {
        expect(pdfRequests).toBe(before); expect(ocrPages.length).toBe(previousOcr);
      }
      if (scenario.deny) expect(pdfRequests).toBe(before);
    }
    expect(ocrPages).toEqual([2, 1]);
    expect(titleHooks).toEqual(cases.map(() => false));
  } finally { engine.kill("SIGKILL"); await engine.exited; fixture.stop(true); await rm(root, { recursive: true, force: true }); }
}, 120000);
