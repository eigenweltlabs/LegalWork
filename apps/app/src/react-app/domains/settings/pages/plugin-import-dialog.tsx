import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { ArrowLeft, Blocks, Bot, ChevronRight, FileArchive, FolderOpen, Layers, Loader2, Package, Plug, RefreshCw, Search, Terminal, TriangleAlert } from "lucide-react";
import type { PluginImportCandidate, PluginImportPreview, PluginImportProvider, PluginImportRequest, PluginImportSource } from "@legalwork/types/plugin-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { ChatGptLogo } from "../../connections/provider-auth/chatgpt-plan-card";
import claudeLogo from "@/assets/claude-logo.svg";
import { HubTabs } from "../segmented-tabs";
import { groupPluginImportCandidates, pluginImportCandidateKey, pluginImportName } from "./plugin-import-presentation";
import { packageParts } from "./skill-packages";

export type PluginImportStore = {
  discoverPluginImports(provider: PluginImportProvider): Promise<PluginImportCandidate[]>;
  previewPluginImports(request: PluginImportRequest): Promise<PluginImportPreview[]>;
  installPluginImport(request: PluginImportRequest): Promise<PluginImportPreview>;
};
const componentTypes: PluginImportPreview["components"][number]["type"][] = ["skill", "mcp", "agent", "command"];
type ImportFilter = "all" | "plugin" | "skill" | "connector";
const componentIcons = { skill: Blocks, mcp: Plug, agent: Bot, command: Terminal };
const componentTitle = (type: PluginImportPreview["components"][number]["type"]) =>
  t(type === "skill" ? "skills.title" : type === "mcp" ? "extensions.connectors_label" : type === "agent" ? "composer.agents_label" : "dashboard.commands");

export function PluginImportDialog(props: { provider: PluginImportProvider; store: PluginImportStore; onClose: () => void; onImported: (preview: PluginImportPreview) => void }) {
  const [candidates, setCandidates] = useState<PluginImportCandidate[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ImportFilter>("all");
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [source, setSource] = useState<PluginImportSource | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [copies, setCopies] = useState<PluginImportCandidate[]>([]);
  const [previews, setPreviews] = useState<PluginImportPreview[]>([]);
  const [selectedRoot, setSelectedRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const selected = previews.find(item => item.root === selectedRoot);
  const groups = groupPluginImportCandidates(candidates);
  const search = query.trim().toLocaleLowerCase();
  const narrowed = search.length > 0 || filter !== "all";
  const filtered = groups.filter(({ candidate }) =>
    (filter === "all" || (candidate.kind ?? "plugin") === filter) &&
    [pluginImportName(candidate), candidate.name, candidate.description].some(value => value?.toLocaleLowerCase().includes(search)));

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setDiscovering(true);
    setDiscoveryFailed(false);
    props.store.discoverPluginImports(props.provider)
      .then(items => { if (!cancelled) setCandidates(items); })
      .catch(() => { if (!cancelled) setDiscoveryFailed(true); })
      .finally(() => { if (!cancelled) setDiscovering(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [props.provider, props.store, discoveryRevision]);

  const preview = async (nextSource: PluginImportSource, label: string) => {
    setBusy(true);
    setError(null);
    setPreviews([]);
    setSource(null);
    setSourceLabel(label);
    setStep("review");
    try {
      const items = await props.store.previewPluginImports({ source: nextSource, scope: "global" });
      if (!mounted.current) return;
      if (!items.length) throw new Error(t("extensions.import_failed"));
      setSource(nextSource);
      setPreviews(items);
      setSelectedRoot(items[0].root);
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : t("extensions.import_failed")); setStep("choose"); }
    } finally { if (mounted.current) setBusy(false); }
  };

  const chooseFolder = async () => {
    if (!isDesktopRuntime()) { folderInput.current?.click(); return; }
    try {
      const folder = await pickDirectory({ title: t("extensions.import_choose_folder") });
      if (typeof folder === "string") {
        setCopies([]);
        await preview({ provider: props.provider, path: folder }, folder.split(/[\\/]/).pop() || t("extensions.import_unnamed"));
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t("extensions.import_failed")); }
  };

  const upload = async (files: FileList | null, folder: boolean) => {
    if (!files?.length) return;
    const entries = Array.from(files);
    const label = entries[0].name;
    setBusy(true);
    setStep("review");
    setError(null);
    setPreviews([]);
    setSource(null);
    setCopies([]);
    setSourceLabel(label);
    try {
      if (entries.length > 5000 || entries.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) throw new Error(t("extensions.import_size_limit"));
      let zipBase64: string;
      if (folder) {
        const zip = new JSZip();
        for (const file of entries) zip.file(file.webkitRelativePath || file.name, await file.arrayBuffer());
        zipBase64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
      } else {
        const bytes = new Uint8Array(await entries[0].arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        zipBase64 = btoa(binary);
      }
      if (mounted.current) await preview({ provider: props.provider, zipBase64 }, label);
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : t("extensions.import_failed")); setBusy(false); setStep("choose"); }
    }
  };

  const install = async () => {
    if (!source || !selected) return;
    setInstalling(true);
    setError(null);
    try {
      await props.store.installPluginImport({ source, scope: "global", root: selected.root, digest: selected.digest });
      toast.success(t(selected.format === "connectors" ? "extensions.import_connector_success" : "extensions.import_success", { name: pluginImportName(selected) }));
      props.onImported(selected);
      props.onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t("extensions.import_failed")); }
    finally { if (mounted.current) setInstalling(false); }
  };

  return <Dialog open onOpenChange={open => { if (!open && !installing) props.onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 bg-background p-0 sm:max-w-2xl" showCloseButton={!installing}>
      <DialogHeader className="shrink-0 px-6 pb-5 pt-6">
        <div className="mb-1 flex items-center gap-2.5 pe-8">
          {props.provider === "chatgpt" ? <ChatGptLogo className="size-6 shrink-0" /> : <img src={claudeLogo} alt="" className="size-6 shrink-0" />}
          <DialogTitle>{t(props.provider === "chatgpt" ? "extensions.import_chatgpt" : "extensions.import_claude")}</DialogTitle>
        </div>
        <DialogDescription>{t(step === "choose" ? "extensions.import_description" : "extensions.import_review_description")}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-5">
        {step === "choose" ? <>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-medium">{t("extensions.import_found")}{!discovering && !discoveryFailed ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{groups.length}</span> : null}</h3>
            <Button variant="ghost" size="icon-sm" disabled={discovering} aria-label={t("extensions.import_rescan")} title={t("extensions.import_rescan")} onClick={() => setDiscoveryRevision(value => value + 1)}><RefreshCw className={discovering ? "animate-spin motion-reduce:animate-none" : ""} /></Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus className="ps-9" aria-label={t("extensions.import_search")} placeholder={t("extensions.import_search")} value={query} onChange={event => setQuery(event.target.value)} />
          </div>
          <HubTabs<ImportFilter>
            label={t("extensions.import_filter")}
            items={[
              { id: "all", label: t("extensions.filter_all") },
              { id: "plugin", label: t("extensions.filter_plugins") },
              { id: "skill", label: t("skills.title") },
              { id: "connector", label: t("extensions.connectors_label") },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <div className="h-72 min-h-28 overflow-y-auto rounded-xl border border-border">
            {discovering ? <div className="flex h-full items-center justify-center gap-2 text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("extensions.import_discovering")}</div>
              : discoveryFailed ? <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><TriangleAlert className="size-6 text-muted-foreground" /><p className="text-muted-foreground">{t("extensions.import_discovery_failed")}</p><Button variant="outline" size="sm" onClick={() => setDiscoveryRevision(value => value + 1)}>{t("extensions.import_retry")}</Button></div>
              : filtered.length ? <div className="divide-y divide-border">{filtered.map(group => {
                const item = group.candidate;
                const Icon = item.kind === "connector" ? Plug : item.kind === "skill" ? Blocks : Package;
                return <Button key={pluginImportCandidateKey(item)} variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-start font-normal" onClick={() => { setCopies(group.sources); void preview({ provider: props.provider, path: item.path, connector: item.connector }, pluginImportName(item)); }}>
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{pluginImportName(item)}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.kind === "connector" ? `${t("extensions.connectors_label")} · ` : ""}{item.description || t(item.kind === "skill" ? "extensions.import_skill" : "extensions.import_plugin")}</span></span>
                  {item.version ? <span className="max-w-24 truncate text-xs text-muted-foreground">{item.version}</span> : null}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Button>;
              })}</div> : <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"><Package className="size-6 text-muted-foreground" /><p className="font-medium">{t(narrowed ? "extensions.import_no_matches" : "extensions.import_none_found")}</p><p className="text-sm text-muted-foreground">{t(narrowed ? "extensions.import_search_hint" : "extensions.import_file_hint")}</p></div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{t("extensions.import_file_source")}</span>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void chooseFolder()}><FolderOpen />{t("extensions.import_choose_folder")}</Button><Button variant="outline" size="sm" onClick={() => zipInput.current?.click()}><FileArchive />{t("extensions.import_choose_zip")}</Button></div>
          </div>
        </> : busy ? <div className="flex min-h-72 flex-col items-center justify-center gap-3" role="status"><Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" /><p className="font-medium">{t("extensions.import_reading", { name: sourceLabel })}</p><p className="text-sm text-muted-foreground">{t("extensions.import_working")}</p></div> : selected ? <>
          {previews.length > 1 ? <div className="space-y-2"><p className="text-sm text-muted-foreground">{t("extensions.import_select_package")}</p><div className="flex flex-wrap gap-2">{previews.map(item => <Button key={item.root} size="sm" variant={selectedRoot === item.root ? "secondary" : "outline"} disabled={installing} aria-pressed={selectedRoot === item.root} onClick={() => setSelectedRoot(item.root)}>{pluginImportName(item)}</Button>)}</div></div> : null}
          <div className="space-y-1"><div className="flex items-baseline gap-2"><h3 className="text-lg font-medium">{pluginImportName(selected)}</h3>{selected.version ? <span className="text-xs text-muted-foreground">{selected.version}</span> : null}</div>{selected.description ? <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{selected.description}</p> : null}{selected.format === "connectors" ? <p className="pt-1 text-sm text-muted-foreground">{t("extensions.import_connector_paused")}</p> : null}<p className="pt-1 text-sm text-muted-foreground">{packageParts(selected.components.map(item => item.type)) || t("extensions.import_no_components")}</p></div>
          {selected.components.length ? <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
            {componentTypes.map(type => {
              const items = selected.components.filter(item => item.type === type);
              if (!items.length) return null;
              const Icon = componentIcons[type];
              return <div key={type} className="px-4 py-3 first:pt-4 last:pb-4"><h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="size-4" />{componentTitle(type)}<span className="tabular-nums">{items.length}</span></h4><ul className="space-y-1.5 ps-6">{items.map(item => <li key={item.installedName} className="truncate text-sm">{pluginImportName(item)}</li>)}</ul></div>;
            })}
          </div> : null}
          {selected.warnings.length ? <details className="rounded-xl border border-border bg-muted/30 px-4 py-3"><summary className="cursor-pointer text-sm font-medium"><span className="inline-flex items-center gap-2"><TriangleAlert className="size-4 text-amber-11" />{t("extensions.import_compatibility", { count: selected.warnings.length })}</span></summary><ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">{selected.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details> : null}
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("extensions.import_details")}</summary><div className="mt-3 space-y-3 rounded-lg bg-muted/30 p-3"><p className="break-all text-xs text-muted-foreground">{source && "path" in source ? source.path : sourceLabel}</p><p className="text-xs text-muted-foreground">{t("extensions.import_file_count", { count: selected.fileCount })} · {(selected.bytes / 1024 / 1024).toFixed(1)} MB</p><p className="text-xs leading-relaxed text-muted-foreground">{t(selected.format === "connectors" ? "extensions.import_connector_resources" : "extensions.import_resources")}</p>{copies.length > 1 ? <div className="space-y-2"><p className="text-xs font-medium">{t("extensions.import_other_copies")}</p>{copies.map(copy => <Button key={copy.path} variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal text-start" disabled={installing} aria-pressed={source !== null && "path" in source && source.path === copy.path} onClick={() => void preview({ provider: props.provider, path: copy.path }, pluginImportName(copy))}><span className="min-w-0"><span className="block">{copy.version || pluginImportName(copy)}</span><span className="block break-all text-xs text-muted-foreground">{copy.path}</span></span></Button>)}</div> : null}</div></details>
        </> : null}
        {error ? <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      </div>

      <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" aria-label={t("extensions.import_choose_zip")} onChange={event => { void upload(event.target.files, false); event.target.value = ""; }} />
      <input ref={element => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple className="hidden" aria-label={t("extensions.import_choose_folder")} onChange={event => { void upload(event.target.files, true); event.target.value = ""; }} />
      <DialogFooter className="mx-0 mb-0 shrink-0 items-center gap-3 px-6 py-4 sm:justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Layers className="size-3.5" />{t("extensions.import_all_projects")}</span>
        {step === "choose" ? <Button variant="outline" onClick={props.onClose}>{t("common.close")}</Button> : <div className="flex items-center gap-2"><Button variant="ghost" disabled={busy || installing} onClick={() => { setStep("choose"); setError(null); }}><ArrowLeft />{t("common.back")}</Button><Button disabled={busy || installing || !selected || !source} aria-busy={installing} onClick={() => void install()}>{installing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}{t(installing ? "extensions.import_installing" : "extensions.import_install")}</Button></div>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
