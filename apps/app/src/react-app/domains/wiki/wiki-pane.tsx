import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronDown, ChevronRight, Code2, Download, Eye, FileText, Folder, GitFork, History, Loader2, Paperclip, Plus, RefreshCw, Save, Search, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { WikiAsset, WikiPage, WikiSnapshot, WikiVault } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importViewerFile } from "../session/panel/import-viewer-file";
import { requestPanelTab } from "../session/panel/panel-tab-request";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { CreateWikiDialog, NewWikiPageDialog, WikiHistoryDialog, WikiSettingsDialog, wikiError, wikiSelectClass, type WikiWorkspaceOption } from "./wiki-dialogs";
import { canRichEditWiki, resolveWikiPage, updateWikiProperty, wikiBacklinks, wikiProcedurePrompt, wikiTemplateContent } from "./wiki-model";
import { useWikiDrafts } from "./wiki-drafts";
import { WikiPreview } from "./wiki-preview";
import { WikiGraphPane, WikiPropertyValue, WikiViewPane } from "./wiki-views";
import "./wiki.css";

const RichEditor = lazy(() => import("../session/artifacts/artifact-markdown-editor").then((module) => ({ default: module.ArtifactMarkdownEditor })));
const controlFiles = ["Structure.md", "Instructions.md", "Templates.md", "Views.md"];
const EMPTY_PAGES: WikiPage[] = [];
const EMPTY_ASSETS: WikiAsset[] = [];

type WikiPaneProps = {
  client: LegalworkServerClient | null;
  serverUrl: string;
  workspaceId: string;
  workspaces: WikiWorkspaceOption[];
  onWikisChanged?: () => void;
  onOpenWikiSession: (wiki: WikiVault, prompt?: string) => Promise<void>;
};

/** The folder is the wiki. The app renders its Markdown without imposing a hierarchy. */
export function WikiPane(props: WikiPaneProps) {
  const queryClient = useQueryClient();
  const [wikiId, setWikiId] = useState("");
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"preview" | "source" | "rich">("preview");
  const [surface, setSurface] = useState("page");
  const [assetLimit, setAssetLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [newWiki, setNewWiki] = useState(false);
  const [newPage, setNewPage] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState(false);
  const [historyPath, setHistoryPath] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [sharingActionError, setSharingActionError] = useState<{ wikiId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const assetUrls = useRef(new Map<string, string>());
  const wikiKey = ["wikis", props.serverUrl];
  const snapshotKey = ["wiki-snapshot", props.serverUrl, wikiId];
  const list = useQuery({ queryKey: wikiKey, queryFn: async () => {
    if (!props.client) throw new Error(t("wiki.offline"));
    return props.client.listWikis();
  }, enabled: Boolean(props.client), refetchInterval: 15000 });
  const snapshot = useQuery({ queryKey: snapshotKey, queryFn: async () => {
    if (!props.client) throw new Error(t("wiki.offline"));
    return props.client.wikiSnapshot(wikiId);
  }, enabled: Boolean(props.client && wikiId), refetchInterval: 5000 });
  const searchResult = useQuery({ queryKey: ["wiki-search", props.serverUrl, wikiId, debouncedSearch], queryFn: async () => {
    if (!props.client) throw new Error(t("wiki.offline"));
    return props.client.searchWiki(wikiId, debouncedSearch);
  }, enabled: Boolean(props.client && wikiId && debouncedSearch.trim()) });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["wiki-snapshot", props.serverUrl] });
    void queryClient.invalidateQueries({ queryKey: ["wikis", props.serverUrl] });
    void queryClient.invalidateQueries({ queryKey: ["wiki-search", props.serverUrl] });
    void queryClient.invalidateQueries({ queryKey: ["wiki-team", props.serverUrl] });
  }, [queryClient, props.serverUrl]);
  const acceptWiki = (updated: WikiVault) => {
    queryClient.setQueryData<WikiSnapshot>(["wiki-snapshot", props.serverUrl, updated.id], (current) => current ? { ...current, wiki: updated } : undefined);
    queryClient.setQueryData<{ items: WikiVault[] }>(["wikis", props.serverUrl], (current) => current ? { items: [...current.items.filter((item) => item.id !== updated.id), updated] } : { items: [updated] });
    refresh();
  };
  const drafts = useWikiDrafts(props.client, props.serverUrl, refresh);
  const wiki = snapshot.data?.wiki ?? list.data?.items.find((item) => item.id === wikiId);
  const pages = snapshot.data?.pages ?? EMPTY_PAGES;
  const assets = snapshot.data?.assets ?? EMPTY_ASSETS;
  const currentPage = pages.find((page) => page.path === path);
  const draft = wikiId && path ? drafts.get(wikiId, path) : undefined;
  const dirty = Boolean(draft && draft.content !== draft.baseline);
  const backlinks = useMemo(() => wikiBacklinks(pages, path), [pages, path]);
  const richAllowed = draft ? canRichEditWiki(draft.content) : false;
  const visiblePages = debouncedSearch.trim() ? searchResult.data?.items ?? [] : pages.filter((page) => !controlFiles.includes(page.path));
  const selectedView = snapshot.data?.views.find((view) => `view:${view.name}` === surface);
  const sharingError = sharingActionError?.wikiId === wikiId ? sharingActionError.message : wiki?.pendingSharing ? wiki.syncStatus.error ?? t("wiki.sharing_pending") : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!wikiId && list.data?.items.length) setWikiId(list.data.items[0].id);
  }, [wikiId, list.data]);
  useEffect(() => {
    if (!path && pages.length) setPath(pages.find((page) => /^(Wiki|Home|Index|README)\.md$/i.test(page.path))?.path ?? pages[0].path);
  }, [pages, path]);
  useEffect(() => {
    if (!wikiId || !path) return;
    let cancelled = false;
    setDocumentLoading(true); setPageError(null);
    void drafts.load(wikiId, path).catch((err) => { if (!cancelled) setPageError(wikiError(err)); }).finally(() => { if (!cancelled) setDocumentLoading(false); });
    return () => { cancelled = true; };
  }, [wikiId, path, currentPage?.revision, drafts.load]);
  useEffect(() => {
    if (mode === "rich" && !richAllowed) setMode("source");
  }, [mode, richAllowed]);
  useEffect(() => () => { for (const url of assetUrls.current.values()) URL.revokeObjectURL(url); assetUrls.current.clear(); }, []);

  const openPage = (nextPath: string) => { setPath(nextPath); setSurface("page"); setDeleteConfirm(false); setPageError(null); };
  const chooseWiki = (id: string) => { setWikiId(id); setPath(""); setSurface("page"); setSearch(""); setDebouncedSearch(""); setDeleteConfirm(false); setPageError(null); };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); }
    catch (error) { toast.error(t("wiki.operation_failed"), { description: wikiError(error) }); }
    finally { setBusy(false); }
  };
  const resolveAssetPath = useCallback((source: string) => {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(source)) throw new Error(t("wiki.invalid_asset"));
    let decoded: string;
    try { decoded = decodeURIComponent(source.split("#")[0]); } catch { throw new Error(t("wiki.invalid_asset")); }
    if (assets.some((asset) => asset.path === decoded)) return decoded;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parts: string[] = [];
    for (const part of `${parent ? `${parent}/` : ""}${decoded}`.split("/")) {
      if (part === "..") { if (!parts.length) throw new Error(t("wiki.invalid_asset")); parts.pop(); }
      else if (part !== "." && part) parts.push(part);
    }
    return parts.join("/");
  }, [path, assets]);
  const imagePreview = useCallback(async (source: string) => {
    if (!props.client || !wikiId) throw new Error(t("wiki.offline"));
    const assetPath = resolveAssetPath(source);
    const asset = assets.find((item) => item.path === assetPath);
    const key = `${wikiId}:${assetPath}:${asset?.updatedAt}`;
    const previous = assetUrls.current.get(key); if (previous) return previous;
    const result = await props.client.downloadWikiAsset(wikiId, assetPath);
    // Never embed SVG/HTML in the privileged app document.
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(result.contentType ?? "")) throw new Error(t("wiki.invalid_image"));
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    assetUrls.current.set(key, url); return url;
  }, [props.client, wikiId, resolveAssetPath, assets]);
  const uploadAsset = useCallback(async (file: File) => {
    if (!props.client || !wiki) throw new Error(t("wiki.offline"));
    const name = file.name.replace(/[\\/<>:"|?*%#\x00-\x1f]/g, "_").replace(/^\.+/, "");
    const target = `Attachments/${crypto.randomUUID().slice(0, 8)}-${name || "file"}`;
    const result = await props.client.uploadWikiAsset(wiki.id, target, await file.arrayBuffer());
    refresh(); return result.path;
  }, [props.client, wiki, refresh]);
  const uploadImage = useCallback(async (file: File) => (await uploadAsset(file)).split("/").map(encodeURIComponent).join("/"), [uploadAsset]);
  const downloadAsset = async (source: string) => {
    if (!props.client || !wiki) return;
    const assetPath = resolveAssetPath(source);
    const result = await props.client.downloadWikiAsset(wiki.id, assetPath);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = assetPath.split("/").at(-1) ?? "attachment";
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openAsset = async (source: string) => {
    if (!props.client || !wiki) return;
    if (!props.workspaceId) { await downloadAsset(source); return; }
    const assetPath = resolveAssetPath(source);
    const result = await props.client.downloadWikiAsset(wiki.id, assetPath);
    const file = new File([result.data], assetPath.split("/").at(-1) ?? "attachment", { type: result.contentType ?? "application/octet-stream" });
    requestPanelTab(await importViewerFile(props.client, props.workspaceId, file));
  };
  const startSession = async (prompt?: string) => {
    if (!wiki) return;
    for (const item of drafts.dirty.filter((item) => item.wikiId === wiki.id)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = drafts.get(wiki.id, item.path);
        if (!current || current.content === current.baseline) break;
        if (!await drafts.save(wiki.id, item.path)) throw new Error(t("wiki.save_before_session"));
      }
      const current = drafts.get(wiki.id, item.path);
      if (current && current.content !== current.baseline) throw new Error(t("wiki.save_before_session"));
    }
    await props.onOpenWikiSession(wiki, prompt);
  };

  return <div className="flex h-full min-h-0 w-full flex-col bg-background">
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3"><BookOpen size={21} strokeWidth={1.5} className="text-primary" /><h1 className="text-lg font-semibold tracking-tight">{t("wiki.title")}</h1>{list.data?.items.length ? <select className={`${wikiSelectClass} max-w-60`} value={wikiId} onChange={(event) => chooseWiki(event.target.value)} aria-label={t("wiki.select_wiki")}>{list.data.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}<div className="ml-auto flex items-center gap-1"><Button size="sm" variant="ghost" aria-label={t("wiki.refresh")} disabled={busy || !props.client} onClick={() => void run(async () => { if (wiki?.sync) await props.client?.syncWiki(wiki.id); refresh(); })}><RefreshCw size={15} className={busy ? "animate-spin" : ""} /></Button>{wiki ? <Button size="sm" variant="ghost" aria-label={t("wiki.settings")} onClick={() => setSettings(true)}><Settings2 size={15} /></Button> : null}<Button size="sm" variant="outline" disabled={!props.client} onClick={() => setNewWiki(true)}><Plus size={15} />{t("wiki.new_wiki")}</Button></div></header>
    {!props.client ? <EmptyWiki message={t("wiki.offline")} /> : list.error ? <EmptyWiki message={wikiError(list.error)} action={<Button variant="outline" onClick={() => void list.refetch()}>{t("wiki.retry")}</Button>} /> : list.isLoading ? <EmptyWiki message={t("wiki.loading")} /> : !wikiId ? <EmptyWiki message={t("wiki.empty_hint")} action={<Button onClick={() => setNewWiki(true)}><Plus size={16} />{t("wiki.new_wiki")}</Button>} /> : <>
      {sharingError ? <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-amber-500/5 px-5 py-2 text-xs text-amber-700 dark:text-amber-400"><span>{t("wiki.sharing_pending")} {sharingError === t("wiki.sharing_pending") ? null : sharingError}</span><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSettings(true)}>{t("wiki.retry_sharing")}</Button></div> : null}
      {wiki && ((!sharingError && wiki.syncStatus.error) || wiki.syncStatus.conflicts.length) ? <div className="flex flex-wrap items-center gap-2 border-b bg-amber-500/5 px-5 py-2 text-xs text-amber-700 dark:text-amber-400"><span>{wiki.syncStatus.error ?? t("wiki.conflicts", { count: wiki.syncStatus.conflicts.length })}</span><span>{t("wiki.local_changes_safe")}</span>{wiki.syncStatus.conflicts.map((conflict) => <button key={conflict} className="underline" onClick={() => openPage(conflict)}>{conflict}</button>)}</div> : null}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/15 max-md:w-44"><div className="space-y-2 border-b p-3"><div className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 pl-8 text-xs" placeholder={t("wiki.search")} aria-label={t("wiki.search")} /></div><Button size="sm" variant="outline" className="w-full" disabled={!wiki?.writable} onClick={() => setNewPage("")}><Plus size={14} />{t("wiki.new_page")}</Button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!debouncedSearch.trim() ? <><p className="mb-1 px-2 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("wiki.structure")}</p>{controlFiles.map((file) => {
              const page = pages.find((entry) => entry.path === file);
              return page ? <PageRow key={file} page={page} active={surface === "page" && path === file} onOpen={openPage} /> : null;
            })}<button className={cn("mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent", surface === "graph" && "bg-accent font-medium")} onClick={() => setSurface("graph")}><GitFork size={14} />{t("wiki.graph")}</button>{snapshot.data?.views.map((view) => <button key={view.name} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent", surface === `view:${view.name}` && "bg-accent font-medium")} onClick={() => setSurface(`view:${view.name}`)}><FileText size={14} className="shrink-0" /><span className="truncate">{view.name}</span></button>)}<p className="mb-1 mt-4 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("wiki.pages")}</p></> : null}
            {searchResult.isFetching && debouncedSearch.trim() ? <Loader2 size={14} className="m-2 animate-spin" /> : null}{searchResult.error && debouncedSearch.trim() ? <p className="p-2 text-xs text-destructive">{wikiError(searchResult.error)}</p> : null}
            <PageTree key={`${wikiId}:${debouncedSearch}`} pages={visiblePages} active={surface === "page" ? path : ""} onOpen={openPage} searching={Boolean(debouncedSearch.trim())} />
            {assets.length && !debouncedSearch.trim() ? <details className="mt-4"><summary className="cursor-pointer px-2 py-1.5 text-xs text-muted-foreground">{t("wiki.attachments")} · {assets.length}</summary>{assets.slice(0, assetLimit).map((asset) => <div key={asset.path} className="flex items-center rounded-lg hover:bg-accent"><button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs" onClick={() => void run(() => openAsset(asset.path))}><Paperclip size={12} className="shrink-0" /><span className="truncate">{asset.path.split("/").at(-1)}</span></button><Button size="icon" variant="ghost" className="size-6 shrink-0" aria-label={t("wiki.download", { name: asset.path.split("/").at(-1) ?? asset.path })} onClick={() => void run(() => downloadAsset(asset.path))}><Download size={12} /></Button></div>)}{assets.length > assetLimit ? <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setAssetLimit((current) => current + 100)}>{t("wiki.show_more", { remaining: assets.length - assetLimit })}</Button> : null}</details> : null}
          </div><div className="border-t p-2"><Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => { setHistoryPath(""); setHistory(true); }}><History size={14} />{t("wiki.all_history")}</Button><p className="px-2 pb-1 text-[10px] text-muted-foreground">{wiki?.sync ? t("wiki.automatic_sync") : t("wiki.local_wiki")}</p></div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {snapshot.error ? <EmptyWiki message={wikiError(snapshot.error)} action={<Button variant="outline" onClick={() => void snapshot.refetch()}>{t("wiki.retry")}</Button>} /> : snapshot.isLoading ? <EmptyWiki message={t("wiki.loading")} /> : surface === "graph" ? <WikiGraphPane pages={pages} focus={path || null} onOpen={openPage} /> : selectedView ? <WikiViewPane view={selectedView} pages={pages} writable={Boolean(wiki?.writable)} key={selectedView.name} onOpen={openPage} onMove={async (pagePath, property, value) => {
            if (!props.client || !wiki) return;
            const pending = drafts.get(wiki.id, pagePath);
            if (pending && pending.content !== pending.baseline) throw new Error(t("wiki.save_before_move"));
            const doc = await props.client.readWikiPage(wiki.id, pagePath);
            await props.client.writeWikiPage(wiki.id, { path: pagePath, content: updateWikiProperty(doc.content, property, value), baseRevision: doc.revision });
            await drafts.load(wiki.id, pagePath); refresh();
          }} /> : <>
            {wiki ? <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2"><span className="mr-auto min-w-0 truncate text-xs text-muted-foreground" title={path}>{path || wiki.name}</span><div className="flex rounded-lg border p-0.5">{[{ id: "preview", icon: Eye, label: "wiki.preview" }, { id: "source", icon: Code2, label: "wiki.markdown" }].map((item) => <Button key={item.id} size="sm" variant={mode === item.id ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setMode(item.id === "source" ? "source" : "preview")}><item.icon size={13} />{t(item.label)}</Button>)}{richAllowed ? <Button size="sm" variant={mode === "rich" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setMode("rich")}>{t("wiki.rich_editor")}</Button> : null}</div>{draft ? <><Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" disabled={!dirty || draft.saving || !wiki.writable} onClick={() => void drafts.save(wiki.id, path)}>{draft.saving ? <Loader2 size={13} className="animate-spin" /> : dirty ? <Save size={13} /> : <Check size={13} />}{t(draft.saving ? "wiki.saving" : dirty ? "wiki.save" : "wiki.saved")}</Button><Button size="sm" variant="ghost" aria-label={t("wiki.history")} onClick={() => { setHistoryPath(path); setHistory(true); }}><History size={14} /></Button>{wiki.writable ? <><Button size="sm" variant="ghost" aria-label={t("wiki.attach_file")} onClick={() => uploadInput.current?.click()} disabled={busy}><Paperclip size={14} /></Button><Button size="sm" variant="ghost" aria-label={t("wiki.delete_page")} className={deleteConfirm ? "text-destructive" : ""} disabled={busy || draft.saving} onClick={() => { if (!deleteConfirm) { setDeleteConfirm(true); return; } void run(async () => { await props.client?.deleteWikiPage(wiki.id, { path, baseRevision: draft.revision }); drafts.remove(wiki.id, path); setPath(""); setDeleteConfirm(false); refresh(); }); }}><Trash2 size={14} />{deleteConfirm ? t("wiki.delete_confirm") : null}</Button></> : null}</> : null}</div> : null}
            {draft?.error ? <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-4 py-3 text-xs"><span className="mr-auto text-destructive">{draft.error} {t("wiki.draft_preserved")}</span><Button size="sm" variant="outline" onClick={() => void drafts.save(wikiId, path)}>{t("wiki.retry")}</Button><Button size="sm" variant="outline" onClick={() => { if (!props.client || !wiki) return; void run(async () => { const copyPath = `${path.replace(/\.md$/i, "")}-draft-${Date.now()}.md`; await props.client?.writeWikiPage(wiki.id, { path: copyPath, content: draft.content }); drafts.remove(wiki.id, path); openPage(copyPath); refresh(); }); }}>{t("wiki.save_copy")}</Button><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("wiki.discard_confirm"))) void run(() => drafts.load(wikiId, path, true)); }}>{t("wiki.reload_saved")}</Button></div> : null}
            {pageError ? <EmptyWiki message={pageError} action={<Button variant="outline" onClick={() => { setHistoryPath(path); setHistory(true); }}>{t("wiki.history")}</Button>} /> : documentLoading && !draft ? <EmptyWiki message={t("wiki.loading")} /> : draft ? <>
              {currentPage && Object.keys(currentPage.properties).length > 0 && mode === "preview" ? <div className="flex flex-wrap gap-x-6 gap-y-2 border-b bg-muted/20 px-6 py-3 text-xs">{Object.entries(currentPage.properties).filter(([key]) => key !== "id").map(([key, value]) => <div key={key}><span className="mr-2 text-muted-foreground">{key}</span><WikiPropertyValue value={value} pages={pages} fromPath={path} onOpen={openPage} /></div>)}</div> : null}
              <div className="min-h-0 flex-1 overflow-auto">{mode === "source" ? <textarea spellCheck={false} aria-label={t("wiki.markdown")} className="block h-full min-h-80 w-full resize-none bg-background p-6 font-mono text-sm leading-7 text-foreground outline-none md:p-8" value={draft.content} readOnly={!wiki?.writable} onChange={(event) => drafts.change(wikiId, path, event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); void drafts.save(wikiId, path); } }} /> : mode === "rich" ? <Suspense fallback={<EmptyWiki message={t("wiki.loading")} />}><RichEditor key={`${wikiId}:${path}`} value={draft.content} baseline={draft.baseline} onChange={(content) => drafts.change(wikiId, path, content)} readOnly={!wiki?.writable} imageUpload={uploadImage} imagePreview={imagePreview} /></Suspense> : <><WikiPreview content={draft.content} path={path} pages={pages} onOpen={openPage} onMissing={(target) => { if (wiki?.writable) setNewPage(target.split("#")[0]); else toast.error(t("wiki.missing_link")); }} onAsset={(assetPath) => void run(() => openAsset(assetPath))} imagePreview={imagePreview} />{backlinks.length ? <div className="mx-auto mb-8 max-w-[800px] border-t px-6 pt-5"><p className="mb-2 text-xs font-medium text-muted-foreground">{t("wiki.backlinks")}</p><div className="flex flex-wrap gap-2">{backlinks.map((page) => <Button key={page.path} variant="outline" size="sm" onClick={() => openPage(page.path)}>{page.title}</Button>)}</div></div> : null}</> }</div>
            </> : <EmptyWiki message={t("wiki.empty_pages")} action={<Button disabled={!wiki?.writable} onClick={() => setNewPage("")}>{t("wiki.new_page")}</Button>} />}
          </>}
          {wiki ? <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2"><Sparkles size={14} className="text-primary" /><Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void run(() => startSession())}>{t("wiki.agent_session")}</Button><Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Bootstrap.md", "help me build useful wiki knowledge from selected documents. First establish the topic and source scope.")))}>{t("wiki.extract")}</Button><Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Capture.md", "help capture reusable learning from this matter. First establish the source work.")))}>{t("wiki.capture")}</Button><Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Maintain.md", "maintain this wiki within the requested scope. First establish the scope and sources.")))}>{t("wiki.maintain")}</Button></div> : null}
          {snapshot.data?.warnings.length ? <details className="border-t px-4 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{t("wiki.warnings", { count: snapshot.data.warnings.length })}</summary><ul className="mt-2 space-y-1">{snapshot.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
        </main>
      </div>
    </>}
    <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { const files = [...event.target.files ?? []]; event.target.value = ""; if (!files.length) return; void run(async () => { for (const file of files) { const uploaded = await uploadAsset(file); if (draft) { const latest = drafts.get(wikiId, path); if (latest) drafts.change(wikiId, path, `${latest.content}\n\n[${file.name.replace(/[\[\]]/g, "")}](${uploaded.split("/").map(encodeURIComponent).join("/")})\n`); } } toast.success(t("wiki.uploaded")); }); }} />
    {newWiki && props.client ? <CreateWikiDialog client={props.client} serverUrl={props.serverUrl} wikis={list.data?.items ?? []} onClose={() => setNewWiki(false)} onCreate={async (input) => { const result = await props.client?.createWiki(input); if (!result) return; setNewWiki(false); chooseWiki(result.wiki.id); acceptWiki(result.wiki); setSharingActionError(result.sharingError ? { wikiId: result.wiki.id, message: result.sharingError } : null); props.onWikisChanged?.(); }} onJoin={async (input) => { const result = await props.client?.joinWiki(input); if (!result) return; setNewWiki(false); chooseWiki(result.wiki.id); acceptWiki(result.wiki); props.onWikisChanged?.(); }} /> : null}
    {settings && props.client && wiki ? <WikiSettingsDialog key={wiki.id} client={props.client} serverUrl={props.serverUrl} wiki={wiki} projectWorkspaces={props.workspaces.filter((workspace) => !list.data?.items.some((item) => item.workspaceId === workspace.id))} onClose={() => setSettings(false)} onUpdate={async (input) => { const result = await props.client?.updateWiki(wiki.id, input); if (result) acceptWiki(result.wiki); setSettings(false); }} onShare={async (input, update) => { const result = update ? await props.client?.updateWikiSharing(wiki.id, input) : await props.client?.shareWiki(wiki.id, input); if (result) { acceptWiki(result.wiki); setSharingActionError(null); } }} onStopSharing={async () => { const result = await props.client?.stopWikiSharing(wiki.id); if (result) { acceptWiki(result.wiki); setSharingActionError(null); } }} onForget={async () => { if (drafts.dirty.some((item) => item.wikiId === wiki.id)) throw new Error(t("wiki.save_before_forget")); await props.client?.forgetWiki(wiki.id); setSettings(false); chooseWiki(""); refresh(); }} /> : null}
    {newPage !== null && props.client && wiki ? <NewWikiPageDialog key={`${wiki.id}:${newPage}`} pages={pages} initialPath={newPage} onClose={() => setNewPage(null)} onCreate={async (newPath, templatePath) => { if (pages.some((page) => page.path.toLocaleLowerCase() === newPath.toLocaleLowerCase())) throw new Error(t("wiki.page_exists")); let content = `# ${newPath.split("/").at(-1)?.replace(/\.md$/i, "")}\n\n`; if (templatePath) { const template = await props.client?.readWikiPage(wiki.id, templatePath); const page = pages.find((entry) => entry.path === templatePath); if (template && page) content = wikiTemplateContent(template.content, page, newPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? newPath); } await props.client?.writeWikiPage(wiki.id, { path: newPath, content }); setNewPage(null); setMode("source"); openPage(newPath); refresh(); }} /> : null}
    {history && props.client && wiki ? <WikiHistoryDialog key={`${wiki.id}:${historyPath}`} client={props.client} wikiId={wiki.id} initialPath={historyPath} onClose={() => setHistory(false)} onRestore={async (restorePath, revisionId) => { if (drafts.get(wiki.id, restorePath)?.content !== drafts.get(wiki.id, restorePath)?.baseline) throw new Error(t("wiki.save_before_restore")); let baseRevision: string | undefined; try { baseRevision = (await props.client?.readWikiPage(wiki.id, restorePath))?.revision; } catch (error) { if (!(error instanceof LegalworkServerError && error.status === 404)) throw error; } await props.client?.restoreWikiPage(wiki.id, { path: restorePath, revisionId, baseRevision }); await drafts.load(wiki.id, restorePath, true); refresh(); toast.success(t("wiki.restored")); }} /> : null}
  </div>;
}

function EmptyWiki(props: { message: string; action?: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-8 text-center"><BookOpen size={36} strokeWidth={1} className="text-muted-foreground/40" /><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{props.message}</p>{props.action}</div>;
}
function PageRow(props: { page: WikiPage; active: boolean; onOpen: (path: string) => void }) {
  return <button className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent", props.active && "bg-accent font-medium")} title={props.page.path} onClick={() => props.onOpen(props.page.path)}><FileText size={13} className="shrink-0 text-muted-foreground" /><span className="truncate">{props.page.title}</span></button>;
}
function PageTree(props: { pages: WikiPage[]; active: string; onOpen: (path: string) => void; searching: boolean }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [limit, setLimit] = useState(100);
  const visible = props.pages.slice(0, limit);
  const groups = useMemo(() => {
    const map = new Map<string, WikiPage[]>();
    for (const page of visible) { const folder = page.path.includes("/") ? page.path.slice(0, page.path.lastIndexOf("/")) : ""; const group = map.get(folder); if (group) group.push(page); else map.set(folder, [page]); }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [props.pages, limit]);
  const more = props.pages.length > limit ? <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => setLimit((current) => current + 100)}>{t("wiki.show_more", { remaining: props.pages.length - limit })}</Button> : null;
  if (props.searching) return <>{visible.map((page) => <PageRow key={page.path} page={page} active={props.active === page.path} onOpen={props.onOpen} />)}{more}</>;
  return <>{groups.map(([folder, pages]) => <div key={folder}>{folder ? <button className="mt-2 flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-muted-foreground" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })} aria-expanded={!collapsed.has(folder)}>{collapsed.has(folder) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={12} /><span className="truncate">{folder}</span></button> : null}{!collapsed.has(folder) ? <div className={folder ? "pl-3" : ""}>{pages.map((page) => <PageRow key={page.path} page={page} active={props.active === page.path} onOpen={props.onOpen} />)}</div> : null}</div>)}{more}</>;
}
