import { useEffect, useRef } from "react";
import { CheckSquare, FileText, Folder, LayoutGrid, ListTodo, MessageSquare, Mic, Pin, Square } from "lucide-react";
import type { LauncherResultAction, LauncherSearchKind, LauncherSearchResult, LauncherSourceState } from "@legalwork/types/launcher";
import { formatRelativeTime } from "@/app/utils";
import { searchTerms } from "@legalwork/types/search";
import { t } from "@/i18n";
import { primaryResultAction, resultActionMenu } from "./action-catalog";
import { resultKey } from "./launcher-search-session";

const KIND_ORDER: LauncherSearchKind[] = ["projects", "files", "chats", "tasks", "recordings"];
const ICONS = { projects: LayoutGrid, files: FileText, chats: MessageSquare, tasks: ListTodo, recordings: Mic };

export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  return <>{text.split(new RegExp(`(${terms.join("|")})`, "gi")).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>;
}
export function coverageLabel(sources: LauncherSourceState[]) {
  if (!sources.length) return "";
  if (sources.some(source => source.coverage === "searching")) return t("launcher.coverage.searching");
  if (sources.some(source => source.coverage === "indexing")) return t("launcher.coverage.indexing");
  const unavailable = sources.filter(source => source.coverage === "unavailable" || source.coverage === "offline");
  if (unavailable.length) return t("launcher.coverage.unavailable", { count: unavailable.length, names: unavailable.map(source => source.label).join(", ") });
  if (sources.some(source => source.coverage === "filename-only")) return t("launcher.coverage.filename_only");
  if (sources.some(source => source.coverage === "partial" || source.limited)) return t("launcher.coverage.partial");
  return "";
}
export function actionLabel(action: LauncherResultAction | "run" | "open-conversation") { return t(`launcher.result_action.${action}`); }

export function LauncherResultList(props: {
  items: LauncherSearchResult[]; sources: LauncherSourceState[]; query: string; selectedKey: string | null; multiSelect: Set<string>; pins: Set<string>; pending: boolean;
  onSelect: (key: string) => void; onRun: (result: LauncherSearchResult, action: LauncherResultAction) => void; onToggleMulti: (key: string) => void; onOpenActions: (key: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.selectedKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(props.selectedKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [props.selectedKey]);
  const groups = KIND_ORDER.map(kind => ({ kind, items: props.items.filter(item => item.kind === kind), sources: props.sources.filter(source => source.kind === kind) })).filter(group => group.items.length || (group.sources.length && props.query));
  if (!groups.length) return <div className="launcher-empty">{props.pending ? t("launcher.coverage.searching") : props.query.length === 1 ? t("content_search.keep_typing") : t("content_search.no_results")}</div>;
  return <div ref={listRef} role="listbox" aria-label={t("content_search.title")} aria-multiselectable="true">
    {groups.map(group => <section key={group.kind}>
      <div className="launcher-section-title"><span>{t(`launcher.kind.${group.kind}`)}</span><span className="launcher-coverage">{coverageLabel(group.sources)}</span></div>
      {group.items.map(item => {
        const key = resultKey(item);
        const Icon = ICONS[item.kind];
        const primary = primaryResultAction(item);
        const multi = props.multiSelect.has(key);
        return <div key={key} role="option" aria-selected={props.selectedKey === key} data-key={key} data-selected={props.selectedKey === key} data-multi={multi} className="launcher-row"
          onMouseEnter={() => props.onSelect(key)} onClick={event => { if (event.metaKey || event.ctrlKey) props.onToggleMulti(key); else props.onRun(item, primary); }} onContextMenu={event => { event.preventDefault(); props.onSelect(key); props.onOpenActions(key); }}>
          <span className="launcher-row-icon" onClick={event => { event.stopPropagation(); props.onToggleMulti(key); }} aria-hidden="true">{item.kind === "files" ? multi ? <CheckSquare className="size-4" /> : props.multiSelect.size ? <Square className="size-4" /> : <Icon className="size-4" /> : <Icon className="size-4" />}</span>
          <div className="launcher-row-main">
            <div className="launcher-row-title"><Highlight text={item.title} query={props.query} />{props.pins.has(key) && <Pin className="ml-1 inline size-3 text-muted-foreground" aria-label={t("launcher.result_action.pin")} />}</div>
            <div className="launcher-row-meta">{[item.subtitle, item.path && item.path !== item.title ? item.path : null, item.completed ? t("tasks.status_done") : item.status, item.updatedAt ? formatRelativeTime(item.updatedAt) : null].filter(Boolean).join(" · ")}{item.incomplete ? ` · ${t("content_search.partial")}` : ""}</div>
            {item.excerpt && item.excerpt !== item.path && <div className="launcher-row-excerpt"><Highlight text={item.excerpt} query={props.query} /></div>}
          </div>
          <span className="launcher-row-hint">{props.selectedKey === key ? `↵ ${actionLabel(primary)}` : item.kind === "projects" ? <Folder className="size-3.5" /> : null}</span>
        </div>;
      })}
    </section>)}
  </div>;
}

export function LauncherActionMenu(props: { result: LauncherSearchResult; multiSelected: number; pinned: boolean; onRun: (action: LauncherResultAction) => void; onClose: () => void }) {
  const actions = resultActionMenu(props.result, props.multiSelected);
  const indexRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); props.onClose(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      indexRef.current = (indexRef.current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % Math.max(1, buttons.length);
      buttons[indexRef.current]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [props]);
  return <div ref={menuRef} className="launcher-actions-menu" role="menu" aria-label={props.result.title}>
    {actions.map(action => <button key={action} type="button" role="menuitem" onClick={() => props.onRun(action)}>{action === "pin" && props.pinned ? t("launcher.result_action.unpin") : actionLabel(action)}{action === "compare" && props.multiSelected >= 2 ? ` (${props.multiSelected})` : ""}</button>)}
  </div>;
}
