import { useMemo } from "react";
import { Bot, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { getSessionActivityStatusLabel, useSessionActivityStore, type SessionActivityStatus } from "../status/session-activity-store";
import { emptyInteractionSessions, interactionSessionIds, interactionSessionsKey, type InteractionSession, type InteractionSessions } from "../sync/interaction-state";

export type SubagentSession = InteractionSession & { status: SessionActivityStatus };
const emptyStatuses: Record<string, SessionActivityStatus> = {};
const emptyPendingSessionIds: string[] = [];

export function chatSubagents(sessionId: string, sessions: InteractionSessions, statuses: Record<string, SessionActivityStatus>, pendingSessionIds: string[] = emptyPendingSessionIds): SubagentSession[] {
  const waiting = new Set(pendingSessionIds);
  return interactionSessionIds(sessionId, sessions).slice(1).flatMap(id => {
    const session = sessions[id];
    return session ? [{ ...session, status: waiting.has(id) ? "waiting" : statuses[id] ?? "idle" }] : [];
  });
}

export function SessionSubagents({ workspaceId, sessionId, pendingSessionIds = emptyPendingSessionIds, onOpenSession }: {
  workspaceId: string; sessionId: string; pendingSessionIds?: string[]; onOpenSession?: (sessionId: string) => void;
}) {
  const key = useMemo(() => interactionSessionsKey(workspaceId), [workspaceId]);
  const sessions = useQueryCacheState<InteractionSessions>(key, emptyInteractionSessions);
  const statuses = useSessionActivityStore(state => state.statusesByWorkspaceId[workspaceId] ?? emptyStatuses);
  const agents = useMemo(() => chatSubagents(sessionId, sessions, statuses, pendingSessionIds), [sessionId, sessions, statuses, pendingSessionIds]);
  return <SubagentList agents={agents} onOpenSession={onOpenSession} />;
}

export function SubagentList({ agents, onOpenSession }: {
  agents: SubagentSession[]; onOpenSession?: (sessionId: string) => void;
}) {
  if (!agents.length) return null;
  const active = agents.filter(agent => agent.status !== "idle");
  const completed = agents.filter(agent => agent.status === "idle");
  const waiting = active.filter(agent => agent.status === "waiting").length;
  const failed = active.filter(agent => agent.status === "error").length;
  const running = active.length - waiting - failed;
  const summary = [
    running ? t("session.subagents_running", { count: running }) : "",
    waiting ? t("session.subagents_waiting", { count: waiting }) : "",
    failed ? t("session.subagents_failed", { count: failed }) : "",
    !active.length ? t("session.subagents_completed", { count: completed.length }) : "",
  ].filter(Boolean).join(" · ");

  const rows = (items: SubagentSession[]) => items.map(agent => (
    <Button key={agent.id} variant="ghost" size="sm" disabled={!onOpenSession}
      onClick={() => onOpenSession?.(agent.id)}
      aria-label={`${t("session.open_subagent_chat")}: ${agent.title || t("session.subagent")}`}
      className="h-8 w-full justify-start gap-2 rounded-md px-2 text-xs font-normal">
      {agent.status === "idle" ? <Check className="size-3.5 text-muted-foreground" /> : <Bot className="size-3.5" />}
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{agent.title || t("session.subagent")}</span>
      <span className={cn("shrink-0 text-muted-foreground", agent.status === "waiting" && "text-amber-11", agent.status === "error" && "text-red-11")}>
        {agent.status === "idle" ? t("session.subagent_completed") : getSessionActivityStatusLabel(agent.status)}
      </span>
    </Button>
  ));

  return <Collapsible className="shrink-0 border-b border-dls-border px-4 md:px-8">
    <div className="lw-session-column">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 py-2 text-xs text-muted-foreground hover:text-foreground">
        <Bot className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{t("session.subagents")}</span>
        <span className="truncate">{summary}</span>
        <ChevronRight className="ml-auto size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-[min(13rem,25vh)] overflow-y-auto pb-2">
          {rows(active)}
          {completed.length > 0 && <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-2 py-2 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 transition-transform group-aria-expanded:rotate-90" />
              {t("session.subagents_completed", { count: completed.length })}
            </CollapsibleTrigger>
            <CollapsibleContent>{rows(completed)}</CollapsibleContent>
          </Collapsible>}
        </div>
      </CollapsibleContent>
    </div>
  </Collapsible>;
}
