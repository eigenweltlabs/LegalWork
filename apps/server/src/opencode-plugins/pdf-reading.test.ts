import { expect, test } from "bun:test";
import { pdfReading } from "./pdf-reading.js";

const file: { type: "file"; mime: string; url: string; id: string; sessionID: string; messageID: string } = { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,JVBERi0=", id: "prt_original", sessionID: "chat", messageID: "msg_original" };
const args = { filePath: "/project/scan.pdf" };

test("read's native definition gains OCR and page options", async () => {
  const plugin = pdfReading("/project");
  const output: { description: string; jsonSchema?: unknown } = { description: "Native file reader." };
  await plugin["tool.definition"]({ toolID: "read" }, output);
  expect(JSON.stringify(output.jsonSchema)).toContain('"ocr"');
  expect(JSON.stringify(output.jsonSchema)).toContain('"pages"');
  expect(output.description).toContain("no PDF skill or shell");
});

test("PDF-capable models keep the actual native PDF attachment and its engine identity", async () => {
  const plugin = pdfReading("/project");
  await plugin["chat.params"]({ sessionID: "chat", agent: "build", message: { agent: "build" }, model: { capabilities: { input: { pdf: true } } } });
  const output = { title: "scan.pdf", output: "PDF read successfully", metadata: { loaded: ["instructions"] }, attachments: [file] };
  await plugin["tool.execute.after"]({ tool: "read", sessionID: "chat", callID: "call", args }, output);
  expect(output.attachments).toEqual([file]);
  expect(output.metadata).toMatchObject({ loaded: ["instructions"], extraction: "pdf" });
});

test("background title, summary and compaction models cannot change foreground PDF routing", async () => {
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname === "/workspaces") return Response.json({ items: [{ id: "project", path: "/project" }] });
    return Response.json({ source_hash: "fixture", page_count: 1, extraction: "native", complete: true,
      pages: [{ page: 1, text: "Native contract marker", extraction: "native" }] });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin;
  try {
    for (const pdf of [true, false]) {
      const plugin = pdfReading("/project");
      await plugin["chat.params"]({ sessionID: "chat", agent: "build", message: { agent: "build" }, model: { capabilities: { input: { pdf } } } });
      for (const agent of ["title", "summary", "compaction"]) {
        await plugin["chat.params"]({ sessionID: "chat", agent, message: { agent: "build" }, model: { capabilities: { input: { pdf: !pdf } } } });
        const result = await plugin.read(file, {}, { sessionID: "chat", directory: "/project" });
        expect(result.metadata.extraction).toBe(pdf ? "pdf" : "native");
        expect(result.attachments ?? []).toEqual(pdf ? [file] : []);
        if (!pdf) expect(result.output).toContain("Native contract marker");
      }
    }
  } finally {
    server.stop(true);
    if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL;
    else process.env.LEGALWORK_SERVER_URL = previousUrl;
  }
});

test("normal files and non-read tools retain their original result", async () => {
  const plugin = pdfReading();
  const output = { title: "notes.txt", output: "1: notes", metadata: {} };
  await plugin["tool.execute.after"]({ tool: "read", sessionID: "chat", callID: "call", args }, output);
  expect(output.output).toBe("1: notes");
});

test("missing model capabilities fail explicitly instead of guessing PDF support", async () => {
  const plugin = pdfReading("/project");
  await expect(plugin["tool.execute.after"]({ tool: "read", sessionID: "chat", callID: "call", args },
    { title: "PDF", output: "", metadata: {}, attachments: [file] })).rejects.toThrow("PDF capability");
});

test("PDF-capable models retain the PDF when explicitly requested OCR is unavailable", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => Response.json({ message: "Unavailable" }, { status: 503 }), previous);
  try {
    const plugin = pdfReading("/project");
    await plugin["chat.params"]({ sessionID: "chat", agent: "build", message: { agent: "build" }, model: { capabilities: { input: { pdf: true } } } });
    const result = await plugin.read(file, { ocr: true }, { sessionID: "chat", directory: "/project" });
    expect(result.attachments).toEqual([file]);
    expect(result.metadata).toMatchObject({ extraction: "pdf", complete: false });
    expect(result.output).toContain("Explicit OCR failed");
    // A model switch must update the route for the same chat.
    await plugin["chat.params"]({ sessionID: "chat", agent: "build", message: { agent: "build" }, model: { capabilities: { input: { pdf: false } } } });
    await expect(plugin.read(file, {}, { sessionID: "chat", directory: "/project" })).rejects.toThrow();
  } finally { globalThis.fetch = previous; }
});
