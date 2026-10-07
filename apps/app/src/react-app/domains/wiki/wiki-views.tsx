import { useMemo, useState } from "react";
import type { WikiPage, WikiValue, WikiView } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { resolveWikiPage, wikiGraph, wikiValueText, wikiViewPages } from "./wiki-model";
import { wikiSelectClass } from "./wiki-dialogs";

export function WikiPropertyValue(props: { value: WikiValue | undefined; pages: WikiPage[]; fromPath: string; onOpen: (path: string) => void }) {
  if (Array.isArray(props.value)) return <span className="inline-flex flex-wrap gap-x-1">{props.value.map((value, index) => <span key={index}><WikiPropertyValue {...props} value={value} />{index < (Array.isArray(props.value) ? props.value.length : 0) - 1 ? ", " : ""}</span>)}</span>;
  const text = wikiValueText(props.value);
  const match = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (match) {
    const target = resolveWikiPage(props.pages, match[1], props.fromPath);
    const label = match[1].split("|").at(-1);
    return target ? <button className="text-primary underline underline-offset-2" onClick={() => props.onOpen(target.path)}>{label}</button> : <span title={t("wiki.missing_link")} className="text-muted-foreground underline decoration-dotted">{label}</span>;
  }
  return <>{text || "—"}</>;
}

export function WikiViewPane(props: { view: WikiView; pages: WikiPage[]; onOpen: (path: string) => void; onMove: (path: string, property: string, value: string) => Promise<void>; writable: boolean }) {
  const pages = useMemo(() => wikiViewPages(props.pages, props.view), [props.pages, props.view]);
  const [limit, setLimit] = useState(200);
  const [columnLimit, setColumnLimit] = useState(30);
  const visiblePages = pages.slice(0, limit);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const property = props.view.groupBy ?? "stage";
  const stages = [...new Set([...props.view.columns, ...pages.map((page) => wikiValueText(page.properties[property]))])];
  const columns = props.view.columns.length ? props.view.columns : ["title", "type"];
  const move = (path: string, value: string) => {
    if (!props.writable || moving) return;
    setMoving(path); setError(null);
    void props.onMove(path, property, value).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setMoving(null));
  };
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5 md:p-8"><div className="mb-6"><h2 className="text-2xl font-semibold tracking-tight">{props.view.name}</h2><p className="mt-1 text-sm text-muted-foreground">{t("wiki.view_hint")}</p></div>
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {props.view.type === "table" ? <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-medium">{column}</th>)}</tr></thead><tbody>{visiblePages.map((page) => <tr key={page.path} className="border-t hover:bg-muted/30">{columns.map((column) => <td className="px-4 py-3" key={column}>{column === "title" || column === "path" ? <button className="text-left font-medium hover:underline" onClick={() => props.onOpen(page.path)}>{column === "title" ? page.title : page.path}</button> : <WikiPropertyValue value={column === "type" ? page.type : page.properties[column]} pages={props.pages} fromPath={page.path} onOpen={props.onOpen} />}</td>)}</tr>)}</tbody></table></div> : <div className="flex min-h-0 gap-4 overflow-x-auto pb-4">{stages.slice(0, columnLimit).map((stage) => {
      const group = visiblePages.filter((page) => wikiValueText(page.properties[property]) === stage);
      return <section key={stage} className="w-64 shrink-0 rounded-xl bg-muted/40 p-3" onDragOver={(event) => { if (props.writable) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const path = event.dataTransfer.getData("application/legalwork-wiki-page"); if (pages.some((page) => page.path === path)) move(path, stage); }}><h3 className="mb-3 flex items-center justify-between px-1 text-sm font-medium">{stage || t("wiki.unassigned")}<span className="text-xs text-muted-foreground">{group.length}</span></h3><div className="space-y-3">{group.map((page) => <article key={page.path} draggable={props.writable && !moving} onDragStart={(event) => event.dataTransfer.setData("application/legalwork-wiki-page", page.path)} className="rounded-lg border bg-background p-3 shadow-xs"><button className="mb-2 w-full text-left text-sm font-medium hover:text-primary" onClick={() => props.onOpen(page.path)}>{page.title}</button>{page.excerpt ? <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{page.excerpt}</p> : null}{props.writable ? <select aria-label={t("wiki.move_stage", { page: page.title })} className={`${wikiSelectClass} h-7 text-xs`} disabled={Boolean(moving)} value={stage} onChange={(event) => move(page.path, event.target.value)}>{stages.map((value) => <option key={value} value={value}>{value || t("wiki.unassigned")}</option>)}</select> : null}</article>)}</div></section>;
    })}</div>}
    {stages.length > columnLimit && props.view.type === "kanban" ? <Button variant="outline" size="sm" className="mt-4 self-start" onClick={() => setColumnLimit((current) => current + 30)}>{t("wiki.more_columns", { remaining: stages.length - columnLimit })}</Button> : null}
    {pages.length > limit ? <Button variant="outline" size="sm" className="mt-4 self-start" onClick={() => setLimit((current) => current + 200)}>{t("wiki.show_more", { remaining: pages.length - limit })}</Button> : null}
    {pages.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("wiki.empty_view")}</p> : null}
  </div>;
}

export function WikiGraphPane(props: { pages: WikiPage[]; focus: string | null; onOpen: (path: string) => void }) {
  const [global, setGlobal] = useState(!props.focus);
  const graph = useMemo(() => wikiGraph(props.pages, global ? null : props.focus), [props.pages, global, props.focus]);
  const points = new Map(graph.pages.map((page, index) => {
    const isCenter = !global && page.path === props.focus;
    const angle = (index / Math.max(graph.pages.length, 1)) * Math.PI * 2;
    const radius = graph.pages.length <= 12 ? 210 : 190 + (index % 3) * 40;
    return [page.path, { x: isCenter ? 400 : 400 + Math.cos(angle) * radius, y: isCenter ? 300 : 300 + Math.sin(angle) * radius }];
  }));
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5 md:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight">{t("wiki.graph")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("wiki.graph_hint")}</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={global} onChange={(event) => setGlobal(event.target.checked)} />{t("wiki.whole_wiki")}</label></div>
    <svg className="wiki-graph min-h-80 w-full flex-1" viewBox="0 0 800 600" role="img" aria-label={t("wiki.graph")}>{graph.edges.map((edge, index) => {
      const from = points.get(edge.from); const to = points.get(edge.to);
      return from && to ? <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y}><title>{edge.label ?? `${edge.from} → ${edge.to}`}</title></line> : null;
    })}{graph.pages.map((page) => {
      const point = points.get(page.path); if (!point) return null;
      return <g key={page.path} role="button" tabIndex={0} aria-label={page.title} className="cursor-pointer" onClick={() => props.onOpen(page.path)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onOpen(page.path); } }}><title>{page.title}</title><circle cx={point.x} cy={point.y} r={page.path === props.focus ? 12 : 7} /><text x={point.x} y={point.y + 27} textAnchor="middle">{page.title.length > 24 ? `${page.title.slice(0, 22)}…` : page.title}</text></g>;
    })}</svg>
    {graph.truncated ? <p className="text-xs text-muted-foreground">{t("wiki.graph_limit", { count: graph.pages.length })}</p> : null}
    <div className="flex flex-wrap gap-1">{graph.pages.map((page) => <Button key={page.path} size="sm" variant="ghost" onClick={() => props.onOpen(page.path)}>{page.title}</Button>)}</div>
  </div>;
}
