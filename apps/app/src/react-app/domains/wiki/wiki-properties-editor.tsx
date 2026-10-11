import { useId, useMemo, useRef, useState } from "react";
import { ListFilter, Plus } from "lucide-react";
import type { WikiPage } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { setWikiProperty, wikiPageRelations, wikiPropertyFields, type WikiPropertyField, type WikiPropertyScalar, type WikiPropertyValue } from "./wiki-properties";
import { WikiPagePropertyPicker } from "./wiki-page-property-picker";

type Props = { content: string; pages: WikiPage[]; path: string; onChange: (content: string) => void; onSource: () => void; onOpen: (path: string) => void };

function PropertyInput({ field, pages, onCommit }: { field: WikiPropertyField; pages: WikiPage[]; onCommit: (value: WikiPropertyScalar) => void }) {
  const id = useId();
  const value = field.value;
  const text = value == null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const cancelled = useRef(false);
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const suggestions = useMemo(() => [...new Set(pages.flatMap(page => typeof page.properties[field.key] === "string" ? [String(page.properties[field.key])] : []))].slice(0, 100), [pages, field.key]);
  if (typeof value === "boolean") return <input aria-label={field.key} type="checkbox" checked={value} onChange={event => onCommit(event.target.checked)} className="accent-primary" />;
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft === text) return;
    if (typeof value === "number") {
      if (!draft.trim() || !Number.isFinite(Number(draft))) { setDraft(text); return; }
      onCommit(Number(draft));
    } else onCommit(draft);
  };
  return <><input aria-label={field.key} className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none" type={typeof value === "number" ? "number" : date ? "date" : "text"} step={typeof value === "number" ? "any" : undefined} list={suggestions.length && !date ? id : undefined} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { cancelled.current = true; setDraft(text); event.currentTarget.blur(); } }} /><datalist id={id}>{suggestions.map(option => <option key={option} value={option} />)}</datalist></>;
}

export function WikiPropertiesEditor(props: Props) {
  const parsed = useMemo(() => wikiPropertyFields(props.content), [props.content]);
  const content = useRef(props.content);
  content.current = props.content;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("text");
  const [newRelation, setNewRelation] = useState<string | string[] | null>(null);
  const [relationKinds, setRelationKinds] = useState<Record<string, "page" | "pages">>({});
  const [error, setError] = useState<string | null>(null);
  const update = (key: string, value: WikiPropertyValue) => {
    try { content.current = setWikiProperty(content.current, key, value); props.onChange(content.current); setError(null); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  };
  return <details className="wiki-properties" open={parsed.error || undefined}>
    <summary><ListFilter size={14} /><span>{t("wiki.properties")}</span><span className="wiki-count">{parsed.fields.length}</span></summary>
    {parsed.error ? <div className="flex items-center gap-2 text-sm text-destructive">{t("wiki.properties_invalid")}<Button variant="ghost" size="sm" onClick={props.onSource}>{t("wiki.edit_source")}</Button></div> : <>
      <div className="mt-2 grid gap-1">{parsed.fields.map(field => {
        const relationKey = `${props.path}\0${field.key}`;
        const relation = wikiPageRelations(field.value) || field.value === null && relationKinds[relationKey];
        return <div key={field.key} className="grid min-h-8 grid-cols-[minmax(90px,140px)_minmax(0,1fr)] items-center gap-2"><span className="truncate text-xs text-muted-foreground" title={field.key}>{field.key}</span>{field.editable ? relation ? <WikiPagePropertyPicker name={field.key} value={typeof field.value === "string" || Array.isArray(field.value) ? field.value : null} multiple={Array.isArray(field.value) || relationKinds[relationKey] === "pages"} pages={props.pages} path={props.path} onOpen={props.onOpen} onChange={value => { setRelationKinds(current => ({ ...current, [relationKey]: Array.isArray(field.value) ? "pages" : "page" })); update(field.key, value); }} /> : <PropertyInput key={JSON.stringify([field.key, field.value])} field={field} pages={props.pages} onCommit={value => update(field.key, value)} /> : <button type="button" className="truncate px-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={props.onSource} title={field.source}>{field.source || t("wiki.edit_source")}</button>}</div>;
      })}</div>
      {adding ? <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!name.trim() || parsed.fields.some(field => field.key === name.trim())) return; const value = kind === "number" ? 0 : kind === "boolean" ? false : kind === "date" ? new Date().toISOString().slice(0, 10) : kind === "page" || kind === "pages" ? newRelation : ""; if (update(name.trim(), value)) { if (kind === "page" || kind === "pages") setRelationKinds(current => ({ ...current, [`${props.path}\0${name.trim()}`]: kind })); setName(""); setNewRelation(kind === "pages" ? [] : null); setAdding(false); } }}>
        <input autoFocus aria-label={t("wiki.property_name")} placeholder={t("wiki.property_name")} className="min-w-0 rounded-md border bg-transparent px-2 text-sm" value={name} onChange={event => setName(event.target.value)} />
        <select aria-label={t("wiki.property_type")} className="rounded-md border bg-background px-2 text-sm" value={kind} onChange={event => { setKind(event.target.value); setNewRelation(event.target.value === "pages" ? [] : null); }}>{["text", "number", "boolean", "date", "page", "pages"].map(kind => <option key={kind} value={kind}>{t(`wiki.property_${kind}`)}</option>)}</select>
        {(kind === "page" || kind === "pages") && <WikiPagePropertyPicker name={name || t("wiki.property_name")} value={newRelation} multiple={kind === "pages"} pages={props.pages} path={props.path} onOpen={props.onOpen} onChange={setNewRelation} />}
        <Button size="sm" variant="outline" type="submit" disabled={!name.trim() || parsed.fields.some(field => field.key === name.trim())}>{t("wiki.add_property")}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
      </form> : <Button size="sm" variant="ghost" className="mt-1 text-muted-foreground" onClick={() => setAdding(true)}><Plus className="size-3.5" />{t("wiki.add_property")}</Button>}
    </>}{error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="ghost" onClick={props.onSource}>{t("wiki.edit_source")}</Button></div>}
  </details>;
}
