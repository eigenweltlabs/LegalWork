import { WikiSuggestionSchema, type WikiSuggestion } from "@legalwork/types/wiki-suggestions";
import type { ArtifactPanelTab } from "../session/panel/panel-tab-store";

export const suggestionTools = ["wiki_suggest", "wiki_suggestion_update", "wiki_write"];
export function suggestionOutcome(output: unknown) {
  try {
    const value: unknown = typeof output === "string" ? JSON.parse(output) : output;
    const parsed = WikiSuggestionSchema.safeParse(value && typeof value === "object" && "suggestion" in value ? value.suggestion : null);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function suggestionTab(item: Pick<WikiSuggestion, "workspaceId" | "id" | "title" | "filePath">): ArtifactPanelTab {
  return { id: `wiki-suggestion:${item.workspaceId}:${item.id}`, type: "artifact", label: item.title, value: item.filePath, preview: "markdown", wikiSuggestion: { workspaceId: item.workspaceId, id: item.id } };
}
