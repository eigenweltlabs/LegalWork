export type WikiTabLocation =
  | { kind: "page"; path: string; anchor?: string; mode?: "source" }
  | { kind: "asset"; path: string }
  | { kind: "view"; name: string }
  | { kind: "graph"; focus?: string };

export type WikiPanelTab = {
  id: string;
  type: "wiki";
  label: string;
  serverUrl: string;
  wikiId: string;
  location: WikiTabLocation;
};

/** Links to the same page select its tab; anchors do not create duplicate tabs. */
export function wikiPanelTab(serverUrl: string, wikiId: string, location: WikiTabLocation, label: string): WikiPanelTab {
  const target = (location.kind === "page" || location.kind === "asset") ? location.path : location.kind === "view" ? location.name : "";
  return { id: `wiki:${JSON.stringify([serverUrl, wikiId, location.kind, target])}`, type: "wiki", label, serverUrl, wikiId, location };
}
