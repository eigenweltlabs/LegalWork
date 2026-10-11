import { useEffect, useMemo, useRef, useState } from "react";
import { parsePartialJson, type DynamicToolUIPart } from "ai";
import { FileChartColumn, ArrowUpRight, Loader2 } from "lucide-react";
import { useMessageList } from "@/components/chat/message-list-provider";
import { Button } from "@/components/ui/button";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import { viewPanelTab } from "./view-reference";
import { record, viewProgramInput, viewToolOutcome, viewGenerationId, viewDraftTab, useViewGenerationStore } from "./view-generation";

export function ViewToolCard({ part }: { part: DynamicToolUIPart }) {
  const { legalworkClient, sessionId, workspaceId } = useMessageList();
  const request = useRequestPanelTab();
  const [partial, setPartial] = useState<unknown>(null);
  const metadata = part.callProviderMetadata?.opencode;
  const raw = record(metadata) && typeof metadata.rawInput === "string" ? metadata.rawInput : "";
  useEffect(() => { let cancelled = false; if (!raw) { setPartial(null); return; } void parsePartialJson(raw).then(parsed => { if (!cancelled) setPartial(parsed.value); }); return () => { cancelled = true; }; }, [raw]);
  const outcome = useMemo(() => part.state === "output-available" ? viewToolOutcome(part.output) : null, [part.state, part.output]);
  const view = outcome && "view" in outcome ? outcome.view : null;
  const failure = outcome && "error" in outcome ? outcome.error : part.state === "output-error" ? part.errorText : null;
  const pending = part.state === "input-streaming" || part.state === "input-available";
  const input = useMemo(() => viewProgramInput(partial ?? part.input), [partial, part.input]);
  const generationId = legalworkClient ? viewGenerationId(legalworkClient.baseUrl, sessionId, part.toolCallId) : "";
  const opened = useRef(false);
  useEffect(() => {
    if (!legalworkClient || !generationId || !["view_create", "view_update"].includes(part.toolName)) return;
    const store = useViewGenerationStore.getState(), previous = store.entries[generationId];
    if (pending) {
      if (previous?.status === "failed" || previous?.status === "saved") return;
      const next = { serverUrl: legalworkClient.baseUrl, sessionId, workspaceId, toolCallId: part.toolCallId, title: input.title, program: input.program, status: "streaming" } satisfies NonNullable<typeof previous>;
      store.update(generationId, next);
      if (!previous && !opened.current) { opened.current = true; request(viewDraftTab(generationId, next)); }
      return;
    }
    // Historical successful tool cards do not open unsolicited tabs on chat load.
    if (!previous) return;
    if (view) {
      store.update(generationId, { ...previous, status: "saved", saved: view, title: view.title });
      usePanelTabStore.getState().resolveViewTab(generationId, viewPanelTab(legalworkClient.baseUrl, { owner: view.owner, viewId: view.id }, view.title));
    } else store.fail(generationId, failure ?? "Generation ended without a saved view.");
  }, [legalworkClient, generationId, pending, input, view, failure, part.toolName, part.toolCallId, request, sessionId, workspaceId]);
  const open = () => {
    if (!legalworkClient) return;
    if (view) request(viewPanelTab(legalworkClient.baseUrl, { owner: view.owner, viewId: view.id }, view.title));
    else { const generation = useViewGenerationStore.getState().entries[generationId]; if (generation) request(viewDraftTab(generationId, generation)); }
  };
  return <div className="my-3 overflow-hidden rounded-xl border bg-card"><div className="flex items-center gap-3 p-4"><FileChartColumn className="size-5 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{view?.title ?? (failure || !pending ? "View unavailable" : input.title)}</p><p className="text-xs text-muted-foreground">{failure ?? (pending ? "Building in its own tab…" : view?.mode === "dashboard" ? "Live wiki dashboard" : view ? "Report snapshot" : "The agent did not return a saved view.")}</p></div>{legalworkClient && (view || pending) ? <Button size="sm" variant="outline" onClick={open}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Open<ArrowUpRight /></Button> : null}</div></div>;
}
