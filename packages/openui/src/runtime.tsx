import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { Card } from "@openuidev/react-ui/Card";
import { CardHeader } from "@openuidev/react-ui/CardHeader";
import { TextContent } from "@openuidev/react-ui/TextContent";
import { MetricIndicatorInline } from "@openuidev/react-ui/MetricIndicator";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@openuidev/react-ui/Table";
import { BarChart, LineChart, PieChart } from "@openuidev/react-ui/Charts";
import { Tag } from "@openuidev/react-ui/Tag";
import { Callout } from "@openuidev/react-ui/Callout";
import { Input } from "@openuidev/react-ui/Input";
import { ThemeProvider } from "@openuidev/react-ui/ThemeProvider";
import { isLocalOpenUIProgram, schemas, SourceOwnerSchema, type SourceOwner } from "./catalog";

type Row = Record<string, unknown>;
type Column = { field: string; label: string };
const Host = createContext<{ openSource?: (path: string, owner?: SourceOwner, binding?: string) => void; streaming: boolean }>({ streaming: false });
function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function SourceButton({ path, sourceOwner, binding, children }: { path: unknown; sourceOwner?: unknown; binding?: string; children: ReactNode }) {
  const host = useContext(Host);
  const owner = SourceOwnerSchema.safeParse(sourceOwner);
  return typeof path === "string" && host.openSource && !host.streaming
    ? <button type="button" className="lw-view-source" onClick={() => host.openSource?.(path, owner.success ? owner.data : undefined, binding)}>{children}</button>
    : <span>{children}</span>;
}
function DataTable({ rows, columns, searchable = true }: { rows: Row[]; columns: Column[]; searchable?: boolean }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ field: string; desc: boolean } | null>(null);
  const visible = useMemo(() => {
    const next = rows.slice(0, 1000).filter(row => !search || columns.some(col => display(row[col.field]).toLocaleLowerCase().includes(search.toLocaleLowerCase())));
    return sort ? next.sort((a, b) => (typeof a[sort.field] === "number" && typeof b[sort.field] === "number" ? Number(a[sort.field]) - Number(b[sort.field]) : display(a[sort.field]).localeCompare(display(b[sort.field]), undefined, { numeric: true })) * (sort.desc ? -1 : 1)) : next;
  }, [rows, columns, search, sort]);
  return <div className="lw-view-table">{searchable && rows.length > 5 && <Input aria-label="Filter displayed rows" placeholder="Filter displayed rows…" value={search} onChange={event => setSearch(event.target.value)} />}
    <Table><TableHeader><TableRow>{columns.map(col => <TableHead key={col.field}><button type="button" onClick={() => setSort(current => ({ field: col.field, desc: current?.field === col.field && !current.desc }))}>{col.label}{sort?.field === col.field ? sort.desc ? " ↓" : " ↑" : ""}</button></TableHead>)}</TableRow></TableHeader><TableBody>{visible.map((row, i) => <TableRow key={typeof row.path === "string" ? row.path : i}>{columns.map((col, j) => <TableCell key={col.field}>{j === 0 ? <SourceButton path={row.path} sourceOwner={row.__viewSourceOwner}>{display(row[col.field])}</SourceButton> : display(row[col.field])}</TableCell>)}</TableRow>)}</TableBody></Table>
    {!visible.length && <p className="lw-view-muted">No matching records</p>}
  </div>;
}
function Board({ rows, groupBy, titleField, fields = [] }: { rows: Row[]; groupBy: string; titleField: string; fields?: Column[] }) {
  const groups = new Map<string, Row[]>();
  for (const row of rows.slice(0, 1000)) { const key = display(row[groupBy]) || "Unassigned"; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return <div className="lw-view-board">{[...groups].map(([name, items]) => <section key={name} className="lw-view-board-column"><div className="lw-view-board-heading"><Tag text={name} size="sm" /><span>{items.length}</span></div>{items.map((row, i) => <Card key={typeof row.path === "string" ? row.path : i} width="full" className="lw-view-board-card"><SourceButton path={row.path} sourceOwner={row.__viewSourceOwner}><strong>{display(row[titleField]) || "Untitled"}</strong></SourceButton>{fields.map(field => <div className="lw-view-board-field" key={field.field}><span>{field.label}</span><span>{display(row[field.field])}</span></div>)}</Card>)}</section>)}</div>;
}
function Chart({ kind, rows, category, series, title }: { kind: "bar" | "line" | "pie"; rows: Row[]; category: string; series: string[]; title?: string }) {
  const data = rows.slice(0, 1000).flatMap(row => {
    const entry: Record<string, string | number> = { [category]: display(row[category]) };
    for (const field of series) if (typeof row[field] === "number" && Number.isFinite(row[field])) entry[field] = row[field];
    return Object.keys(entry).length > 1 ? [entry] : [];
  });
  return <div className="lw-view-chart">{title && <h3>{title}</h3>}{data.length ? kind === "pie" ? <PieChart data={data} categoryKey={category} dataKey={series[0]} variant="donut" height={280} /> : kind === "bar" ? <BarChart data={data} categoryKey={category} height={280} /> : <LineChart data={data} categoryKey={category} height={280} /> : <p className="lw-view-muted">No numeric data to display</p>}<details><summary>View chart data</summary><DataTable rows={data} columns={[category, ...series].map(field => ({ field, label: field }))} searchable={false} /></details></div>;
}

export const openUILibrary = createLibrary({ id: "legalwork-1", components: [
  defineComponent({ name: "Stack", props: schemas.Stack, description: "Responsive layout", component: ({ props, renderNode }) => <div className="lw-view-stack" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, Math.round(props.columns ?? 1)))}, minmax(0, 1fr))` }}>{props.children.map((child, i) => <div className="lw-view-stack-item" key={i}>{renderNode(child)}</div>)}</div> }),
  defineComponent({ name: "Card", props: schemas.Card, description: "Titled card", component: ({ props, renderNode }) => <Card width="full" className="lw-view-card"><CardHeader title={props.title} subtitle={props.subtitle} /><div className="lw-view-card-body">{props.children.map((child, i) => <div key={i}>{renderNode(child)}</div>)}</div></Card> }),
  defineComponent({ name: "Heading", props: schemas.Heading, description: "Section heading", component: ({ props }) => props.level === 1 ? <h1 className="lw-view-title">{props.text}</h1> : <h2 className="lw-view-heading">{props.text}</h2> }),
  defineComponent({ name: "Text", props: schemas.Text, description: "Plain prose", component: ({ props }) => <TextContent variant="clear"><p className="lw-view-prose">{props.text}</p></TextContent> }),
  defineComponent({ name: "Metric", props: schemas.Metric, description: "Metric with context", component: ({ props }) => <Card width="full" className="lw-view-metric"><div className="lw-view-metric-label">{props.label}</div><MetricIndicatorInline value={display(props.value)} subtext={props.detail} /></Card> }),
  defineComponent({ name: "Table", props: schemas.Table, description: "Data table", component: ({ props }) => <DataTable {...props} /> }),
  defineComponent({ name: "Board", props: schemas.Board, description: "Grouped stage board", component: ({ props }) => <Board {...props} /> }),
  defineComponent({ name: "BarChart", props: schemas.BarChart, description: "Bar chart", component: ({ props }) => <Chart {...props} kind="bar" /> }),
  defineComponent({ name: "LineChart", props: schemas.LineChart, description: "Line chart", component: ({ props }) => <Chart {...props} kind="line" /> }),
  defineComponent({ name: "PieChart", props: schemas.PieChart, description: "Donut chart", component: ({ props }) => <Chart rows={props.rows} category={props.category} series={[props.value]} title={props.title} kind="pie" /> }),
  defineComponent({ name: "Badge", props: schemas.Badge, description: "Status", component: ({ props }) => <Tag text={props.text} variant={props.tone} size="sm" /> }),
  defineComponent({ name: "Callout", props: schemas.Callout, description: "Notice", component: ({ props }) => <Callout title={props.title} description={props.description} variant={props.tone ?? "info"} /> }),
  defineComponent({ name: "Source", props: schemas.Source, description: "Local source", component: ({ props }) => <SourceButton path={props.path} binding={props.binding}>{props.label ?? props.path}</SourceButton> }),
] });
const theme = { fontBody: "var(--font-sans, sans-serif)", fontHeading: "var(--font-sans, sans-serif)", fontLabel: "var(--font-sans, sans-serif)", fontNumbers: "var(--font-sans, sans-serif)", background: "var(--background)", textNeutralPrimary: "var(--foreground)", textNeutralSecondary: "var(--muted-foreground)", borderDefault: "var(--border)" };
export function OpenUIView({ program, query, openSource, streaming = false, dark = false, onError }: { program: string; query?: (name: string) => Promise<unknown>; openSource?: (path: string, owner?: SourceOwner, binding?: string) => void; streaming?: boolean; dark?: boolean; onError?: (message: string) => void }) {
  const themeId = `lw-openui-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const toolProvider = useMemo(() => ({ wiki_query: async (args: Record<string, unknown>) => {
    if (streaming || typeof args.name !== "string" || !query) throw new Error("Data is unavailable for this preview");
    return query(args.name);
  } }), [query, streaming]);
  if (!isLocalOpenUIProgram(program)) return <div role="alert">This view contains an unsupported program format.</div>;
  return <div className="lw-openui" id={themeId}><ThemeProvider mode={dark ? "dark" : "light"} lightTheme={theme} darkTheme={theme} cssSelector={`#${themeId}`}><Host.Provider value={{ openSource, streaming }}><Renderer response={program} library={openUILibrary} isStreaming={streaming} toolProvider={toolProvider} publishObservability={false} queryLoader={<span className="lw-view-query-status" role="status">Updating…</span>} onError={errors => { if (!streaming) onError?.(errors.map(error => error.message).join("\n")); }} /></Host.Provider></ThemeProvider></div>;
}
