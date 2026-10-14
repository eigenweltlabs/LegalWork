import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import type { WorkspaceSessionGroup } from "@/app/types";
import { getDisplaySessionTitle } from "@/app/lib/session-title";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

export type WikiChatHistoryProps = { group?: WorkspaceSessionGroup; selectedSessionId?: string | null; onOpen: (id: string) => void };
export function WikiChatHistory({ group, selectedSessionId, onOpen }: WikiChatHistoryProps) {
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const sessions = (group?.sessions ?? []).filter(session => !session.parentID && !session.time?.archived);
  const visible = sessions.filter(session => getDisplaySessionTitle(session.title).toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
  return <section className="flex max-h-[35%] shrink-0 flex-col border-t p-2" aria-label={t("wiki.chats")}>
    <button className="wiki-nav-row shrink-0" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><MessageSquare size={15} /><span className="flex-1 text-left">{t("wiki.chats")} · {sessions.length}</span><ChevronDown size={14} className={expanded ? "rotate-180" : ""} /></button>
    {expanded && <>
      {sessions.length > 5 && <Input className="my-1 h-8 shrink-0" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("wiki.search_chats")} aria-label={t("wiki.search_chats")} />}
      <div className="min-h-0 overflow-y-auto">
        {visible.map(session => <button key={session.id} className="wiki-nav-row w-full text-left aria-[current=true]:bg-accent" aria-current={session.id === selectedSessionId} onClick={() => onOpen(session.id)} title={getDisplaySessionTitle(session.title)}><span className="truncate">{getDisplaySessionTitle(session.title)}</span></button>)}
        {!visible.length && <p className="px-2 py-2 text-xs text-muted-foreground">{group?.status === "error" ? group.error : group?.status === "loading" || !group ? t("wiki.loading") : t("wiki.no_chats")}</p>}
      </div>
    </>}
  </section>;
}
