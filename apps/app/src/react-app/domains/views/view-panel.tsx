import { useCallback } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import type { ViewPanelTab } from "./view-reference";
import { SavedView } from "./view-renderer";

export function ViewPanel({ client, tab, sessionId }: { client: LegalworkServerClient | null; tab: ViewPanelTab; sessionId: string }) {
  const title = useCallback((label: string) => usePanelTabStore.getState().updateTabLabel(sessionId, tab.id, label), [sessionId, tab.id]);
  return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><SavedView client={client?.baseUrl === tab.serverUrl ? client : null} reference={tab} onTitle={title} /></div>;
}
