import { useEffect, useRef } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { refreshHostApprovals } from "./host-approval-feed";
import { onSyncPoke, useSyncEventsLive } from "@/react-app/kernel/sync-events";
import type { RouteWorkspace } from "./route-workspaces";

/** Feed host decisions into the same per-chat queue as engine permissions. */
export function useHostApprovalSync(client: LegalworkServerClient | null, workspaces: RouteWorkspace[], sessionId: string | null) {
  const latest = useRef({ client, workspaces });
  latest.current = { client, workspaces };
  const workspaceKey = workspaces.map((workspace) => workspace.id).join("|");
  useEffect(() => {
    if (!workspaces.length) return;
    let stopped = false, running = false, pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (heard = false) => {
      clearTimeout(timer);
      if (running) { pending = true; return; }
      running = true;
      try {
        const source = latest.current;
        await refreshHostApprovals(source.client, source.workspaces, () => !stopped && latest.current.client === source.client && latest.current.workspaces === source.workspaces,
          !heard && useSyncEventsLive.getState().live);
      } catch { /* Retain pending decisions while the host reconnects. */ }
      finally {
        running = false;
        if (!stopped) {
          const again = pending;
          pending = false;
          timer = setTimeout(() => void refresh(again), again ? 0 : 5000);
        }
      }
    };
    const unsubscribe = onSyncPoke((poke) => { if (poke.approvals || poke.resync) void refresh(true); });
    const focus = () => { void refresh(true); };
    window.addEventListener("focus", focus);
    void refresh(true);
    return () => { stopped = true; clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", focus); };
  }, [client, workspaces, workspaceKey, sessionId]);
}
