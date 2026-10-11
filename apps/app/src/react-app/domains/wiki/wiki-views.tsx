import { useMemo, useState } from "react";
import { Columns3, FileText, GripVertical, Settings2, Table2 } from "lucide-react";
import type { WikiPage, WikiValue, WikiView } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { resolveWikiPage, wikiValueText, wikiViewPages } from "./wiki-model";
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
  const canEditView = props.writable && props.pages.some((page) => page.path === "Views.md");
  const ViewIcon = props.view.type === "table" ? Table2 : Columns3;
  const move = (path: string, value: string) => {
    if (!props.writable || moving) return;
    setMoving(path); setError(null);
    void props.onMove(path, property, value).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setMoving(null));
  };
  return <div className="wiki-view"><header className="wiki-view-header"><div className="wiki-view-heading"><ViewIcon className="wiki-view-icon" aria-hidden="true" /><div><h2>{props.view.name}</h2><p className="wiki-view-meta">{t("wiki.view_count", { count: pages.length })}</p></div></div>{canEditView ? <div className="wiki-view-actions"><Button variant="ghost" size="sm" onClick={() => props.onOpen("Views.md")}><Settings2 className="size-3.5" aria-hidden="true" />{t("wiki.edit_view")}</Button></div> : null}</header>
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {props.view.type === "table" ? <div className="wiki-table-wrap"><table className="wiki-table"><thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{visiblePages.map((page) => <tr key={page.path}>{columns.map((column) => <td key={column}>{column === "title" || column === "path" ? <button type="button" className="wiki-table-page" onClick={() => props.onOpen(page.path)}>{column === "title" ? <FileText className="size-3.5 shrink-0" aria-hidden="true" /> : null}<span>{column === "title" ? page.title : page.path}</span></button> : <WikiPropertyValue value={column === "type" ? page.type : page.properties[column]} pages={props.pages} fromPath={page.path} onOpen={props.onOpen} />}</td>)}</tr>)}{pages.length === 0 ? <tr><td colSpan={columns.length}><div className="wiki-view-empty"><FileText aria-hidden="true" /><h3>{t("wiki.empty_view")}</h3><p>{t("wiki.empty_view_hint")}</p></div></td></tr> : null}</tbody></table></div> : <div className="wiki-board">{stages.slice(0, columnLimit).map((stage) => {
      const group = visiblePages.filter((page) => wikiValueText(page.properties[property]) === stage);
      const count = pages.filter((page) => wikiValueText(page.properties[property]) === stage).length;
      return <section key={stage} className="wiki-board-column" onDragOver={(event) => { if (props.writable) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const path = event.dataTransfer.getData("application/legalwork-wiki-page"); if (pages.some((page) => page.path === path)) move(path, stage); }}><header className="wiki-board-column-header"><h3>{stage || t("wiki.unassigned")}</h3><span>{count}</span></header><div className="wiki-board-cards">{group.map((page) => <article key={page.path} draggable={props.writable && !moving} onDragStart={(event) => event.dataTransfer.setData("application/legalwork-wiki-page", page.path)} className="wiki-board-card"><button type="button" className="wiki-card-title" onClick={() => props.onOpen(page.path)}>{page.title}</button>{page.excerpt ? <p className="wiki-card-excerpt">{page.excerpt}</p> : null}<div className="wiki-card-footer"><span className="wiki-card-type">{page.type}</span>{props.writable ? <><GripVertical className="wiki-card-grip size-3.5" aria-hidden="true" /><select aria-label={t("wiki.move_stage", { page: page.title })} className={`${wikiSelectClass} wiki-card-stage`} disabled={Boolean(moving)} value={stage} onChange={(event) => move(page.path, event.target.value)}>{stages.map((value) => <option key={value} value={value}>{value || t("wiki.unassigned")}</option>)}</select></> : null}</div></article>)}{count === 0 ? <div className="wiki-board-empty"><p>{t("wiki.empty_column")}</p>{props.writable ? <span>{t("wiki.drop_page")}</span> : null}</div> : null}</div></section>;
    })}{stages.length === 0 ? <div className="wiki-view-empty"><Columns3 aria-hidden="true" /><h3>{t("wiki.empty_view")}</h3><p>{t("wiki.empty_view_hint")}</p></div> : null}</div>}
    {stages.length > columnLimit && props.view.type === "kanban" ? <Button variant="outline" size="sm" className="mt-4 self-start" onClick={() => setColumnLimit((current) => current + 30)}>{t("wiki.more_columns", { remaining: stages.length - columnLimit })}</Button> : null}
    {pages.length > limit ? <Button variant="outline" size="sm" className="mt-4 self-start" onClick={() => setLimit((current) => current + 200)}>{t("wiki.show_more", { remaining: pages.length - limit })}</Button> : null}
  </div>;
}

export { WikiGraphPane } from "./wiki-graph-pane";
