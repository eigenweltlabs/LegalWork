import { create } from "zustand";
import type { BrowserPanelTab } from "@/app/lib/desktop-types";
import { interactionSessionIds, type InteractionSessions } from "../sync/interaction-state";

export function visibleTaskBrowserTabs(tabs: BrowserPanelTab[], sessionId: string, assistant: boolean, sessions: InteractionSessions) {
  const owners = new Set(assistant ? interactionSessionIds(sessionId, sessions) : [sessionId]);
  return tabs.filter(tab => tab.background && !tab.dismissed && tab.taskSessionId && owners.has(tab.taskSessionId));
}

/** Window-local browser inventory, independent of whichever project is visible. */
export const useTaskBrowserTabs = create<{
  tabs: BrowserPanelTab[];
  update: (tabs: BrowserPanelTab[]) => void;
}>(set => ({ tabs: [], update: tabs => set({ tabs }) }));
