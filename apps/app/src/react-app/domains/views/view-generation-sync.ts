import { parsePartialJson, type DynamicToolUIPart } from "ai";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import { record, viewDraftTab, viewGenerationId, viewProgramInput, viewToolOutcome, useViewGenerationStore, type ViewDraftTab, type ViewGeneration } from "./view-generation";
import { viewPanelTab } from "./view-reference";

type Context = { serverUrl: string; workspaceId: string; sessionId: string };

/** Observe the transcript independently of collapsed tool cards or visible tabs. */
export async function syncViewGeneration(context: Context, part: DynamicToolUIPart, open: (tab: ViewDraftTab) => void) {
  if (part.toolName !== "view_create" && part.toolName !== "view_update") return;
  const id = viewGenerationId(context.serverUrl, context.sessionId, part.toolCallId);
  const store = useViewGenerationStore.getState();
  const previous = store.entries[id];
  if (part.state === "input-streaming" || part.state === "input-available") {
    if (previous?.status === "saved" || previous?.status === "failed") return;
    const input = viewProgramInput(part.input);
    const next: ViewGeneration = { ...context, toolCallId: part.toolCallId, title: input.title === "Creating view…" ? previous?.title ?? input.title : input.title,
      program: input.program || previous?.program || "", status: "streaming" };
    store.update(id, next);
    if (!previous) open(viewDraftTab(id, next));
    const metadata = part.callProviderMetadata?.opencode;
    if (record(metadata) && typeof metadata.rawInput === "string" && metadata.rawInput) {
      const parsed = await parsePartialJson(metadata.rawInput);
      // A newer chunk or completion may arrive while parsing this one.
      if (useViewGenerationStore.getState().entries[id] !== next) return;
      const partial = viewProgramInput(parsed.value);
      store.update(id, { ...next, title: partial.title === "Creating view…" ? next.title : partial.title,
        program: partial.program.length > next.program.length ? partial.program : next.program });
    }
    return;
  }
  // Loading a completed historical conversation must not open its old dashboards.
  if (!previous) return;
  const outcome = part.state === "output-available" ? viewToolOutcome(part.output) : { error: part.state === "output-error" ? part.errorText : "Generation ended without a saved view." };
  if ("view" in outcome) {
    const view = outcome.view;
    store.update(id, { ...previous, status: "saved", saved: view, title: view.title });
    usePanelTabStore.getState().resolveViewTab(id, viewPanelTab(context.serverUrl, { owner: view.owner, viewId: view.id }, view.title));
  } else store.fail(id, outcome.error);
}
