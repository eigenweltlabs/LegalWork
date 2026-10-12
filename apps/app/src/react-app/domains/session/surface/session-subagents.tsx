import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Client } from "@/app/types";
import { unwrap } from "@/app/lib/opencode";
import { Check, CircleAlert, Clock3, GitBranch, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useQueryCacheState } from "../../../infra/query-cache-state";
import { emptyInteractionSessions, interactionSessionIds, interactionSessionsKey, type InteractionSessions } from "../sync/interaction-state";
import { getSessionActivityStatusLabel, useSessionActivityStore, type SessionActivityStatus } from "../status/session-activity-store";

const emptyStatuses: Record<string, SessionActivityStatus> = {};
type SubagentActivity = { id: string; title: string; status: SessionActivityStatus };
export const isRunningSubagent = (status: SessionActivityStatus) => status === "thinking" || status === "responding" || status === "compacting";

export function sessionSubagents(sessionId: string, sessions: InteractionSessions, statuses: Record<string, SessionActivityStatus>, waiting: readonly string[] = []) {
  return interactionSessionIds(sessionId, sessions).filter(id => id !== sessionId && sessions[id]).map<SubagentActivity>(id => ({
    id, title: sessions[id].title, status: waiting.includes(id) ? "waiting" : statuses[id] ?? "idle",
  })).sort((a, b) => Number(isRunningSubagent(b.status)) - Number(isRunningSubagent(a.status)));
}

/** Stays open while working in the chat. It is not a modal or a navigation change. */
export function SessionSubagents({ workspaceId, sessionId, client, waiting, onOpen }: {
  workspaceId: string; sessionId: string; client: Client | null; waiting?: string[]; onOpen?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const key = useMemo(() => interactionSessionsKey(workspaceId), [workspaceId]);
  const sessions = useQueryCacheState<InteractionSessions>(key, emptyInteractionSessions);
  const statuses = useSessionActivityStore(state => state.statusesByWorkspaceId[workspaceId] ?? emptyStatuses);
  const agents = sessionSubagents(sessionId, sessions, statuses, waiting);
  const ids = agents.map(agent => agent.id).sort().join("|");
  const runs = useQuery({
    queryKey: ["subagent-run-status", workspaceId], enabled: Boolean(client && ids),
    queryFn: async () => ({ started: Date.now(), statuses: unwrap(await client!.session.status()) }),
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (!runs.data) return;
    const store = useSessionActivityStore.getState();
    for (const id of ids.split("|").filter(Boolean)) {
      if ((store.recordsByWorkspaceId[workspaceId]?.[id]?.updatedAt ?? 0) > runs.data.started) continue;
      store.setRunStatus(workspaceId, id, runs.data.statuses[id] ?? { type: "idle" });
    }
  }, [runs.data, ids, workspaceId]);
  if (!agents.length) return null;
  const count = agents.filter(agent => isRunningSubagent(agent.status)).length;
  return <div className="pointer-events-none absolute inset-x-3 top-2 z-40 flex flex-col items-end">
    <Button variant="ghost" size="sm" className="pointer-events-auto mr-9 h-7 min-w-7 gap-1 rounded-md bg-dls-surface/90 px-1.5 text-muted-foreground" onClick={() => setOpen(value => !value)}
      aria-expanded={open} aria-label={t("session.subagents_running", { count })} title={t("session.subagents_running", { count })}>
      <GitBranch className="size-3.5" strokeWidth={1.6} aria-hidden />{count > 0 ? <span className="text-[11px] tabular-nums">{count}</span> : null}
    </Button>
    {open && <section aria-label={t("session.subagents")} className="pointer-events-auto mt-1 w-72 max-w-full rounded-lg border bg-popover text-popover-foreground shadow-md">
      <div className="flex h-8 items-center justify-between px-2.5"><span className="text-xs font-medium">{t(count > 0 ? "session.subagents_running" : "session.subagents", { count })}</span>
        <Button variant="ghost" size="icon-xs" className="-mr-1" onClick={() => setOpen(false)} aria-label={t("session.subagents_close")}><X className="size-3" /></Button></div>
      <div className="max-h-60 overflow-y-auto px-1 pb-1">{agents.map(agent => {
        const Icon = agent.status === "idle" ? Check : agent.status === "error" ? CircleAlert : agent.status === "waiting" ? Clock3 : LoaderCircle;
        const label = agent.status === "idle" ? t("session.subagent_completed") : getSessionActivityStatusLabel(agent.status);
        return <Button key={agent.id} variant="ghost" disabled={!onOpen} title={`${agent.title} · ${label}`} aria-label={`${agent.title} · ${label}`} onClick={() => onOpen?.(agent.id)} className="h-7 w-full justify-start gap-2 rounded-md px-2 py-0 text-left text-xs font-normal disabled:opacity-100">
          <Icon aria-hidden className={cn("size-3 shrink-0 text-muted-foreground", isRunningSubagent(agent.status) && "text-primary motion-safe:animate-spin", agent.status === "error" && "text-destructive")} />
          <span className="min-w-0 truncate">{agent.title}</span>
        </Button>;
      })}</div>
    </section>}
  </div>;
}
