import { expect, test } from "bun:test";
import { WikiSuggestionSchema, suggestionIdFromFile, wikiSuggestionFile } from "@legalwork/types/wiki-suggestions";
import { suggestionOutcome, suggestionTab } from "../src/react-app/domains/wiki/wiki-suggestion-model";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";

const id = "c9f74905-3cab-400c-94c9-3d5a9e22736f";
const draft = WikiSuggestionSchema.parse({ id, workspaceId: "originating-project", sessionId: "chat", status: "pending", title: "Knowledge", content: "# Knowledge", destination: { wikiId: "wiki", path: "Knowledge.md", baseRevision: null }, createdAt: 1, updatedAt: 1, revision: "r1", filePath: wikiSuggestionFile(id) });

test("suggestion results open a recoverable Markdown tab tied to the originating project", () => {
  const outcome = suggestionOutcome(JSON.stringify({ suggestion: draft, staged: true, published: false }));
  expect(outcome).toEqual(draft);
  const tab = suggestionTab(draft);
  const store = usePanelTabStore;
  store.getState().openTab("workspace:review", tab, undefined, undefined, { besideChat: true });
  const restored = store.getState().readLayout(JSON.parse(JSON.stringify(store.getState().sessions["workspace:review"])));
  expect(restored?.tabs[0]).toEqual(tab);
  expect(tab.wikiSuggestion?.workspaceId).toBe("originating-project");
  expect(suggestionIdFromFile(`/project/${tab.value}`)).toBe(id);
});
test("normal wiki writes and malformed tool outputs are not proposal cards", () => {
  for (const value of ["{", { ok: true, path: "Knowledge.md" }, { suggestion: { id, title: "bad" } }]) expect(suggestionOutcome(value)).toBeNull();
  for (const path of ["draft.md", ".legalwork/tmp/wiki-suggestions/../draft.md", "Knowledge/draft.md"]) expect(suggestionIdFromFile(path)).toBeNull();
});
