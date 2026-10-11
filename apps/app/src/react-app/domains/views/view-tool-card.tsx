import { lazy, Suspense, useEffect, useState } from "react";
import { parsePartialJson, type DynamicToolUIPart } from "ai";
import { ViewRecordSchema } from "@legalwork/types/views";
import { FileChartColumn, ArrowUpRight, Loader2 } from "lucide-react";
import { useMessageList } from "@/components/chat/message-list-provider";
import { Button } from "@/components/ui/button";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { viewPanelTab } from "./view-reference";
const OpenUIView = lazy(() => import("./view-renderer").then(module => ({ default: module.OpenUIView })));
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function programOf(value: unknown): string | null {
  if (!record(value)) return null;
  if (typeof value.program === "string") return value.program;
  return record(value.input) && typeof value.input.program === "string" ? value.input.program : null;
}
function savedView(output: unknown) {
  let value = output;
  if (typeof output === "string") { try { value = JSON.parse(output); } catch { return null; } }
  const parsed = ViewRecordSchema.strip().safeParse(record(value) && value.view ? value.view : value);
  return parsed.success ? parsed.data : null;
}
function failureMessage(output: unknown): string | null {
  let value = output;
  if (typeof output === "string") { try { value = JSON.parse(output); } catch { return null; } }
  if (!record(value) || value.ok !== false) return null;
  return typeof value.error === "string" ? value.error : record(value.error) && typeof value.error.message === "string" ? value.error.message : "The view could not be saved.";
}
export function ViewToolCard({ part }: { part: DynamicToolUIPart }) {
  const { legalworkClient } = useMessageList();
  const request = useRequestPanelTab();
  const [partial, setPartial] = useState<string | null>(null);
  const metadata = part.callProviderMetadata?.opencode;
  const raw = record(metadata) && typeof metadata.rawInput === "string" ? metadata.rawInput : "";
  useEffect(() => { let cancelled = false; if (!raw) { setPartial(null); return; } void parsePartialJson(raw).then(parsed => { if (!cancelled) setPartial(programOf(parsed.value)); }); return () => { cancelled = true; }; }, [raw]);
  const view = part.state === "output-available" ? savedView(part.output) : null;
  const pending = part.state === "input-streaming" || part.state === "input-available";
  const program = programOf(part.input) ?? partial;
  const failure = part.state === "output-available" ? failureMessage(part.output) : part.state === "output-error" ? part.errorText : null;
  return <div className="my-3 overflow-hidden rounded-xl border bg-card"><div className="flex items-center gap-3 p-4"><FileChartColumn className="size-5 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{view?.title ?? (failure || !pending ? "View unavailable" : part.toolName === "view_read" ? "Opening a view" : "Creating a view")}</p><p className="text-xs text-muted-foreground">{failure ?? (pending ? "Building the page…" : view?.mode === "dashboard" ? "Live wiki dashboard" : view ? "Report snapshot" : "The agent did not return a saved view.")}</p></div>{view && legalworkClient ? <Button size="sm" variant="outline" onClick={() => request(viewPanelTab(legalworkClient.baseUrl, { owner: view.owner, viewId: view.id }, view.title))}>Open<ArrowUpRight /></Button> : pending ? <Loader2 className="size-4 animate-spin" /> : null}</div>
    {pending && program && <div className="max-h-[420px] overflow-auto border-t p-5" inert><Suspense fallback={<p className="text-xs text-muted-foreground">Preparing preview…</p>}><OpenUIView program={program} streaming /></Suspense></div>}
  </div>;
}
