import { z } from "zod";
import { pdfReadOptions, pdfTextResult, PDF_MAX_BYTES } from "../pdf-read-schema.js";
import { resolveWorkspaceId, serverUrl, workspaceToolHeaders, type OpenCodeContext } from "./office-plugin-shared.js";

type Attachment = { type: "file"; mime: string; url: string; filename?: string };
type Result = { title: string; output: string; metadata: Record<string, unknown>; attachments?: Attachment[] };
export class PdfToolResult { constructor(readonly result: Result) {} }

const readArgs = pdfReadOptions.extend({
  filePath: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(0).optional(),
});
const modelInput = z.object({ sessionID: z.string(), agent: z.string(), message: z.object({ agent: z.string() }),
  model: z.object({ capabilities: z.object({ input: z.object({ pdf: z.boolean() }) }) }) });
const attachment = z.object({ type: z.literal("file"), mime: z.literal("application/pdf"), url: z.string(), filename: z.string().optional() }).passthrough();

export function pdfReading(directory?: string) {
  const models = new Map<string, boolean>();
  const running = new Map<string, { sessionID: string; controller: AbortController }>();
  const description = " Read PDFs with this tool; no PDF skill or shell is needed. PDF-capable models receive the PDF directly. Other models receive embedded text, using OCR only on pages without text. Set ocr=true only when OCR is explicitly requested or needed for visual additions. pages selects 1-based PDF pages for text/OCR; PDF-capable models still receive the original PDF. For PDF text, offset is a 0-based character offset and limit is a character count (default 16000, maximum 80000); follow next_offset. Other files retain their normal line offsets and limits. Never repeat an unchanged failed read; report the error or change the indicated settings.";

  const read = async (file: Attachment, options: z.infer<typeof pdfReadOptions> & { offset?: number; limit?: number }, context: OpenCodeContext): Promise<Result> => {
    const supportsPdf = context.sessionID ? models.get(context.sessionID) : undefined;
    if (supportsPdf === undefined) throw new Error("PDF reading could not determine the current model's PDF capability. Select a model and retry.");
    const prefix = "data:application/pdf;base64,";
    if (!file.url.startsWith(prefix) || file.url.length - prefix.length > Math.ceil(PDF_MAX_BYTES / 3) * 4)
      throw new Error("PDF reading requires a local PDF attachment of at most 64 MiB.");
    const original: Result = { title: file.filename ?? "PDF", output: JSON.stringify({ extraction: "pdf", message: "PDF supplied directly. Read its text and page images.", ...(options.pages ? { requested_pages: options.pages } : {}) }), metadata: { extraction: "pdf", truncated: false }, attachments: [file] };
    if (supportsPdf && !options.ocr) return original;
    let result: z.infer<typeof pdfTextResult>;
    try {
      const workspace = await resolveWorkspaceId(context, { requireDirectory: true });
      const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/pdf/read`, {
        method: "POST", headers: { ...await workspaceToolHeaders(context), "Content-Type": "application/json" },
        body: JSON.stringify({ dataBase64: file.url.slice(prefix.length), ocr: options.ocr, pages: options.pages }),
        signal: context.abort ? AbortSignal.any([context.abort, AbortSignal.timeout(900000)]) : AbortSignal.timeout(900000),
      });
      if (!response.ok) {
        const error = z.object({ message: z.string() }).safeParse(await response.json().catch(() => null));
        throw new Error(error.success ? error.data.message : `PDF reading failed (HTTP ${response.status}). Check the document and OCR settings before retrying.`);
      }
      result = pdfTextResult.parse(await response.json());
    } catch (error) {
      context.abort?.throwIfAborted();
      if (!supportsPdf) throw error;
      const issue = error instanceof Error ? error.message : "Explicit OCR failed.";
      return { ...original, output: JSON.stringify({ extraction: "pdf", complete: false, ocr_error: issue, message: "The PDF is attached. Explicit OCR failed; report the error." }),
        metadata: { ...original.metadata, complete: false, ocr_error: issue } };
    }
    const full = result.pages.map(page => `[Page ${page.page}]\n${page.text}`).join("\n\n");
    const offset = options.offset ?? 0, end = offset + Math.max(1, Math.min(options.limit ?? 16000, 80000));
    const errors = result.pages.flatMap(page => page.error ? [{ page: page.page, error: page.error }] : []);
    const metadata = { extraction: result.extraction, complete: result.complete, source_hash: result.source_hash,
      page_count: result.page_count, pages: result.pages.map(page => page.page),
      page_sources: result.pages.map(page => ({ page: page.page, extraction: page.extraction })), errors, total_chars: full.length,
      truncated: end < full.length, ...(end < full.length ? { next_offset: end } : {}) };
    return { title: file.filename ?? "PDF", output: JSON.stringify({ ...metadata, text: full.slice(offset, end),
      ...(!result.complete ? { issue: "Some requested pages could not be recognized. Do not infer that missing content is absent. Resolve the reported error before retrying." } : {}) }),
      metadata, ...(supportsPdf ? { attachments: [file] } : {}) };
  };

  return {
    read,
    "chat.params": async (raw: unknown) => {
      const input = modelInput.parse(raw);
      // Title, summary and compaction requests reuse the user's session/message
      // with a different agent. They must not replace its tool-using model.
      if (input.agent !== input.message.agent) return;
      if (models.size >= 1000 && !models.has(input.sessionID)) models.delete(models.keys().next().value!);
      models.set(input.sessionID, input.model.capabilities.input.pdf);
    },
    "tool.definition": async ({ toolID }: { toolID: string }, output: { description: string; jsonSchema?: unknown }) => {
      if (toolID !== "read") return;
      output.description += description;
      // The native decoder keeps its original parameters and permission checks.
      // Extra arguments remain on tool.execute.after's original input object.
      output.jsonSchema = z.toJSONSchema(readArgs);
    },
    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output: Result) => {
      if (input.tool !== "read") return;
      const file = output.attachments?.find(item => item.mime === "application/pdf");
      if (!file) return;
      const args = readArgs.parse(input.args);
      const controller = new AbortController();
      const key = `${input.sessionID}:${input.callID}`;
      running.set(key, { sessionID: input.sessionID, controller });
      try {
        const result = await read(attachment.parse(file), args, { sessionID: input.sessionID, directory, abort: controller.signal });
        output.output = result.output;
        output.metadata = { ...output.metadata, ...result.metadata };
        output.attachments = result.attachments ?? [];
      } finally { running.delete(key); }
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const status = z.object({ sessionID: z.string(), status: z.object({ type: z.string() }) }).safeParse(event.properties);
      if (event.type !== "session.status" || !status.success || status.data.status.type !== "idle") return;
      for (const { sessionID, controller } of running.values()) if (sessionID === status.data.sessionID) controller.abort();
    },
  };
}
