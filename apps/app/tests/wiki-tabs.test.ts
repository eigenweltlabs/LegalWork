import { beforeEach, describe, expect, test } from "bun:test";
import { wikiPanelTab } from "../src/react-app/domains/wiki/wiki-tabs";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { restorePanelLayout, setFileSidebarState, setSidePanelState, useUiStateStore } from "../src/react-app/shell/ui-state-store";

beforeEach(() => usePanelTabStore.setState({ sessions: {}, transcriptArtifactTargets: {} }));

describe("Wiki navigation in the standard viewer", () => {
  test("opening the folder browser does not open a viewer and survives viewer switches", () => {
    const initial = { ...useUiStateStore.getState(), sidePanelState: {}, fileSidebarState: {} };
    const browsing = setFileSidebarState(initial, "chat", "wiki");
    expect(browsing.sidePanelState.chat).toBeUndefined();
    const previewing = setSidePanelState(browsing, "chat", "panel");
    expect(previewing.fileSidebarState.chat).toBe("wiki");
    const closed = setSidePanelState(previewing, "chat", null);
    expect(closed.fileSidebarState.chat).toBe("wiki");
    expect(restorePanelLayout(JSON.parse(JSON.stringify(closed)))).toEqual({ sidePanelState: { chat: null }, fileSidebarState: { chat: "wiki" } });
  });

  test("page links reuse the open tab and update its section while other tabs stay open", () => {
    const store = usePanelTabStore.getState();
    const page = wikiPanelTab("local", "firm", { kind: "page", path: "Processes/Review.md" }, "Review");
    store.openTab("chat", { id: "contract", type: "artifact", label: "Contract", value: "Contract.md", preview: "markdown" });
    store.openTab("chat", page);
    store.openTab("chat", wikiPanelTab("local", "firm", { kind: "view", name: "Processes" }, "Processes"));
    const section = wikiPanelTab("local", "firm", { kind: "page", path: "Processes/Review.md", anchor: "sources" }, "Review");
    store.openTab("chat", section);
    const panel = usePanelTabStore.getState().sessions.chat;
    expect(panel.tabs).toHaveLength(3);
    expect(panel.activeTabId).toBe(page.id);
    expect(panel.tabs.find((tab) => tab.id === page.id)).toEqual(section);
    store.syncArtifactTargets("chat", []);
    expect(usePanelTabStore.getState().sessions.chat.tabs).toHaveLength(3);
  });

  test("the same path across wikis or servers and different view kinds get separate tabs", () => {
    const store = usePanelTabStore.getState();
    const tabs = [
      wikiPanelTab("local", "one", { kind: "page", path: "Guide.md" }, "Guide"),
      wikiPanelTab("local", "two", { kind: "page", path: "Guide.md" }, "Guide"),
      wikiPanelTab("remote", "one", { kind: "page", path: "Guide.md" }, "Guide"),
      wikiPanelTab("local", "one", { kind: "view", name: "Guide.md" }, "Guide"),
      wikiPanelTab("local", "one", { kind: "graph" }, "Graph"),
    ];
    for (const tab of tabs) store.openTab("chat", tab);
    expect(usePanelTabStore.getState().sessions.chat.tabs).toEqual(tabs);
    store.reorderTabs("chat", tabs.map((tab) => tab.id).reverse());
    expect(usePanelTabStore.getState().sessions.chat.tabs).toEqual([...tabs].reverse());
    store.closeTab("chat", tabs[4].id);
    expect(usePanelTabStore.getState().sessions.chat.activeTabId).toBe(tabs[3].id);
    store.selectTab("chat", tabs[0].id);
    expect(usePanelTabStore.getState().sessions.chat.activeTabId).toBe(tabs[0].id);
  });
});
