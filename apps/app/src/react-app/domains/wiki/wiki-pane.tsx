import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Code2, Download, Eye, FileText, Folder, GitFork, History, LayoutList, ListFilter, Loader2, LockKeyhole, MoreHorizontal, PanelLeft, Paperclip, Pencil, Plus, RefreshCw, Save, Search, Settings2, Sparkles, Trash2, Users, X } from "lucide-react";
import type { WikiAsset, WikiPage, WikiSnapshot, WikiVault } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArtifactTextEditor } from "../session/artifacts/artifact-text-editor";
import { importViewerFile } from "../session/panel/import-viewer-file";
import { requestPanelTab } from "../session/panel/panel-tab-request";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PanelHeader } from "@/react-app/design-system/panel-chrome";
import { CreateWikiDialog, NewWikiPageDialog, WikiHistoryDialog, WikiSettingsDialog, wikiError, type WikiWorkspaceOption } from "./wiki-dialogs";
import { canRichEditWiki, updateWikiProperty, wikiBacklinks, wikiNavigationPages, wikiProcedurePrompt, wikiTemplateContent } from "./wiki-model";
import { useWikiDrafts } from "./wiki-drafts";
import { WikiPreview } from "./wiki-preview";
import { WikiGraphPane, WikiPropertyValue, WikiViewPane } from "./wiki-views";
import { wikiPanelTab, type WikiPanelTab } from "./wiki-tabs";
import "./wiki.css";

const RichEditor = lazy(() => import("../session/artifacts/artifact-markdown-editor").then((module) => ({ default: module.ArtifactMarkdownEditor })));
const controlFiles = ["Structure.md", "Instructions.md", "Templates.md", "Views.md"];
const EMPTY_PAGES: WikiPage[] = [];
const EMPTY_ASSETS: WikiAsset[] = [];

export type WikiPaneProps = {
  client: LegalworkServerClient | null;
  serverUrl: string;
  workspaceId: string;
  workspaces: WikiWorkspaceOption[];
  onWikisChanged?: () => void;
  onOpenWikiSession: (wiki: WikiVault, prompt?: string) => Promise<void>;
  display?: "navigation" | "tab";
  tab?: WikiPanelTab;
  headerTarget?: HTMLElement | null;
  onCloseNavigation?: () => void;
  onCloseTab?: () => void;
};

/** The folder is the wiki. The app renders its Markdown without imposing a hierarchy. */
export function WikiPane(props: WikiPaneProps) {
  const navigationOnly = props.display === "navigation";
  const tabOnly = props.display === "tab";
  const queryClient = useQueryClient();
  const [wikiId, setWikiId] = useState(props.tab?.wikiId ?? "");
  const [path, setPath] = useState(props.tab?.location.kind === "page" ? props.tab.location.path : props.tab?.location.kind === "graph" ? props.tab.location.focus ?? "" : "");
  const [pageAnchor, setPageAnchor] = useState(props.tab?.location.kind === "page" ? props.tab.location.anchor ?? "" : "");
  const [mode, setMode] = useState<"preview" | "source" | "rich">(props.tab?.location.kind === "page" && props.tab.location.mode === "source" ? "source" : "preview");
  const [surface, setSurface] = useState(props.tab?.location.kind === "view" ? `view:${props.tab.location.name}` : props.tab?.location.kind === "graph" ? "graph" : "page");
  const [assetLimit, setAssetLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [newWiki, setNewWiki] = useState(false);
  const [newPage, setNewPage] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "sharing" | "agents">("general");
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [history, setHistory] = useState(false);
  const [historyPath, setHistoryPath] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [sharingActionError, setSharingActionError] = useState<{ wikiId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const workbenchBody = useRef<HTMLDivElement>(null);
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
  const setupPages = pages.filter((page) => controlFiles.includes(page.path) || page.type === "skill" || page.type === "template");
  const visiblePages = debouncedSearch.trim() ? searchResult.data?.items ?? [] : pages.filter((page) => !setupPages.includes(page));
  const selectedView = snapshot.data?.views.find((view) => `view:${view.name}` === surface);
  const sharingError = sharingActionError?.wikiId === wikiId ? sharingActionError.message : wiki?.pendingSharing ? wiki.syncStatus.error ?? t("wiki.sharing_pending") : null;

  useEffect(() => {
    if (!props.tab) return;
    const { wikiId, location } = props.tab;
    setWikiId(wikiId);
    setSurface(location.kind === "view" ? `view:${location.name}` : location.kind === "graph" ? "graph" : "page");
    setPath(location.kind === "page" ? location.path : location.kind === "graph" ? location.focus ?? "" : "");
    setPageAnchor(location.kind === "page" ? location.anchor ?? "" : "");
    if (location.kind === "page" && location.mode === "source") setMode("source");
    setPageError(null);
    setDeleteConfirm(false);
  }, [props.tab]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!tabOnly && !wikiId && list.data?.items.length) setWikiId(list.data.items[0].id);
  }, [wikiId, list.data, tabOnly]);
  useEffect(() => {
    if (!navigationOnly && !tabOnly && !path && pages.length) setPath(pages.find((page) => /^(Wiki|Home|Index|README)\.md$/i.test(page.path))?.path ?? pages[0].path);
  }, [pages, path, navigationOnly, tabOnly]);
  useEffect(() => {
    if (navigationOnly || surface !== "page" || !wikiId || !path) return;
    let cancelled = false;
    setDocumentLoading(true); setPageError(null);
    void drafts.load(wikiId, path).catch((err) => { if (!cancelled) setPageError(wikiError(err)); }).finally(() => { if (!cancelled) setDocumentLoading(false); });
    return () => { cancelled = true; };
  }, [wikiId, path, currentPage?.revision, drafts.load, navigationOnly, surface]);
  useEffect(() => {
    if (mode === "rich" && !richAllowed) setMode("source");
  }, [mode, richAllowed]);
  useEffect(() => () => { for (const url of assetUrls.current.values()) URL.revokeObjectURL(url); assetUrls.current.clear(); }, []);

  useEffect(() => {
    const body = workbenchBody.current;
    if (!body || navigationOnly || tabOnly) return;
    const observer = new ResizeObserver(() => { if (body.clientWidth <= 680) setNavigationOpen(false); });
    observer.observe(body);
    return () => observer.disconnect();
  }, [wikiId, navigationOnly, tabOnly]);

  const closeNarrowNavigation = () => { if (workbenchBody.current && workbenchBody.current.clientWidth <= 680) setNavigationOpen(false); };
  const openSurface = (next: string) => {
    if (navigationOnly || tabOnly) {
      const view = snapshot.data?.views.find((view) => `view:${view.name}` === next);
      requestPanelTab(wikiPanelTab(props.serverUrl, wikiId, view ? { kind: "view", name: view.name } : { kind: "graph", focus: path || undefined }, view?.name ?? t("wiki.graph")));
      return;
    }
    setSurface(next); closeNarrowNavigation();
  };
  const openPage = (nextPath: string, anchor = "", nextMode?: "source") => {
    if (navigationOnly || tabOnly) {
      if (!nextPath) { if (tabOnly) props.onCloseTab?.(); return; }
      requestPanelTab(wikiPanelTab(props.serverUrl, wikiId, { kind: "page", path: nextPath, anchor, mode: nextMode }, pages.find((page) => page.path === nextPath)?.title ?? nextPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? nextPath));
      return;
    }
    closeNarrowNavigation(); setPath(nextPath); setPageAnchor(anchor); setSurface("page"); setDeleteConfirm(false); setPageError(null);
  };
  const chooseWiki = (id: string) => { setWikiId(id); setPath(""); setPageAnchor(""); setSurface("page"); setSearch(""); setDebouncedSearch(""); setDeleteConfirm(false); setPageError(null); };
  const openSettings = (tab: "general" | "sharing" | "agents" = "general") => { setSettingsTab(tab); setSettings(true); };
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

  return <div className={cn("wiki-workbench", navigationOnly && "wiki-navigation-pane", tabOnly && "wiki-tab-pane")}>
    {navigationOnly ? <PanelHeader title={t("wiki.title")} icon={<BookOpen size={16} />} headerTarget={props.headerTarget}>{props.onCloseNavigation ? <WikiIconButton label={t("workspace_files.close_panel")} onClick={props.onCloseNavigation}><X size={15} /></WikiIconButton> : null}</PanelHeader> : null}
    {!props.client || list.error || list.isLoading || !wikiId ? <>
      {!navigationOnly ? <header className="wiki-empty-header"><span><BookOpen size={18} />{t("wiki.title")}</span><Button size="sm" variant="outline" disabled={!props.client} onClick={() => setNewWiki(true)}><Plus size={15} />{t("wiki.new_wiki")}</Button></header> : null}
      {!props.client ? <EmptyWiki message={t("wiki.offline")} /> : list.error ? <EmptyWiki message={wikiError(list.error)} action={<Button variant="outline" onClick={() => void list.refetch()}>{t("wiki.retry")}</Button>} /> : list.isLoading ? <WikiLoading /> : <EmptyWiki title={t("wiki.empty_title")} message={t("wiki.empty_hint")} action={<Button onClick={() => setNewWiki(true)}><Plus size={16} />{t("wiki.new_wiki")}</Button>} />}
    </> : <>
      {sharingError ? <div role="alert" className="wiki-notice"><span>{t("wiki.sharing_pending")} {sharingError === t("wiki.sharing_pending") ? null : sharingError}</span><Button size="sm" variant="ghost" onClick={() => openSettings("sharing")}>{t("wiki.retry_sharing")}</Button></div> : null}
      {wiki && ((!sharingError && wiki.syncStatus.error) || wiki.syncStatus.conflicts.length) ? <div role="alert" className="wiki-notice"><span>{wiki.syncStatus.error ?? t("wiki.conflicts", { count: wiki.syncStatus.conflicts.length })} {t("wiki.local_changes_safe")}</span>{wiki.syncStatus.conflicts.map((conflict) => <button key={conflict} className="underline" onClick={() => openPage(conflict)}>{conflict}</button>)}</div> : null}
      <div ref={workbenchBody} className="wiki-workbench-body">
        {navigationOnly || (!tabOnly && navigationOpen) ? <aside className="wiki-sidebar" aria-label={t("wiki.navigation")}>
          <div className="wiki-sidebar-header">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" className="wiki-switcher" aria-label={t("wiki.select_wiki")} />}>
                <BookOpen size={18} strokeWidth={1.6} /><span>{wiki?.name ?? t("wiki.title")}</span><ChevronDown size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
                {list.data?.items.map((item) => <DropdownMenuItem key={item.id} onClick={() => chooseWiki(item.id)}>
                  {item.sync ? <Users size={15} /> : <LockKeyhole size={15} />}<span className="min-w-0 flex-1 truncate">{item.name}</span>{wikiId === item.id ? <Check size={14} /> : null}
                </DropdownMenuItem>)}
                <DropdownMenuSeparator /><DropdownMenuItem onClick={() => setNewWiki(true)}><Plus size={15} />{t("wiki.new_wiki")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="wiki-search"><Search size={15} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("wiki.search")} aria-label={t("wiki.search")} />{search ? <button aria-label={t("wiki.clear_search")} onClick={() => setSearch("")}><X size={13} /></button> : null}</div>
            <Button className="wiki-create-page" size="sm" variant="outline" disabled={!wiki?.writable} onClick={() => setNewPage("")}><Plus size={15} />{t("wiki.new_page")}</Button>
          </div>
          <nav className="wiki-sidebar-content" aria-label={t("wiki.pages")}>
            {snapshot.error ? <p role="alert" className="wiki-search-status">{wikiError(snapshot.error)} <button className="underline" onClick={() => void snapshot.refetch()}>{t("wiki.retry")}</button></p> : null}
            <div className="wiki-section-label"><span>{t(debouncedSearch.trim() ? "wiki.search_results" : "wiki.pages")}</span><span>{visiblePages.length}</span></div>
            {searchResult.isFetching && debouncedSearch.trim() ? <div className="wiki-search-status" role="status"><Loader2 size={14} className="animate-spin" />{t("wiki.searching")}</div> : null}
            {searchResult.error && debouncedSearch.trim() ? <p role="alert" className="wiki-search-status text-destructive">{wikiError(searchResult.error)}</p> : null}
            {!visiblePages.length && !searchResult.isFetching ? <p className="wiki-search-status">{t(debouncedSearch.trim() ? "wiki.no_search_results" : "wiki.empty_pages")}</p> : null}
            <PageTree key={`${wikiId}:${debouncedSearch}`} pages={visiblePages} active={surface === "page" ? path : ""} onOpen={openPage} searching={Boolean(debouncedSearch.trim())} />
            {!debouncedSearch.trim() ? <>
              <div className="wiki-section-label wiki-section-spaced"><span>{t("wiki.views")}</span></div>
              {snapshot.data?.views.map((view) => <button key={view.name} className={cn("wiki-nav-row", surface === `view:${view.name}` && "is-active")} aria-current={surface === `view:${view.name}` ? "page" : undefined} onClick={() => openSurface(`view:${view.name}`)}><LayoutList size={15} /><span>{view.name}</span></button>)}
              <button className={cn("wiki-nav-row", surface === "graph" && "is-active")} aria-current={surface === "graph" ? "page" : undefined} onClick={() => openSurface("graph")}><GitFork size={15} /><span>{t("wiki.graph")}</span></button>
              {assets.length ? <details className="wiki-sidebar-disclosure"><summary><Paperclip size={14} /><span>{t("wiki.attachments")}</span><span className="wiki-count">{assets.length}</span></summary>{assets.slice(0, assetLimit).map((asset) => <div key={asset.path} className="wiki-asset-row"><button className="wiki-nav-row" onClick={() => void run(() => openAsset(asset.path))}><FileText size={14} /><span>{asset.path.split("/").at(-1)}</span></button><WikiIconButton label={t("wiki.download", { name: asset.path.split("/").at(-1) ?? asset.path })} onClick={() => void run(() => downloadAsset(asset.path))}><Download size={13} /></WikiIconButton></div>)}{assets.length > assetLimit ? <Button size="sm" variant="ghost" className="w-full" onClick={() => setAssetLimit((current) => current + 100)}>{t("wiki.show_more", { remaining: assets.length - assetLimit })}</Button> : null}</details> : null}
              {setupPages.length ? <details className="wiki-sidebar-disclosure wiki-setup" open={setupPages.some((page) => page.path === path) && surface === "page" ? true : undefined}><summary><Settings2 size={14} /><span>{t("wiki.setup")}</span></summary><PageTree pages={setupPages} active={surface === "page" ? path : ""} onOpen={openPage} searching={false} /></details> : null}
            </> : null}
          </nav>
          <div className="wiki-sidebar-footer">
            {navigationOnly ? <div className="wiki-navigation-settings"><Button size="sm" variant="ghost" disabled={!wiki} onClick={() => openSettings("sharing")}><Users size={14} />{t("wiki.sharing")}</Button><WikiIconButton label={t("wiki.settings")} disabled={!wiki} onClick={() => openSettings()}><Settings2 size={15} /></WikiIconButton></div> : null}
            <button className="wiki-nav-row" onClick={() => { setHistoryPath(""); setHistory(true); }}><History size={15} /><span>{t("wiki.all_history")}</span></button>
            <div className="wiki-vault-status"><span>{wiki?.sync ? <Users size={13} /> : <LockKeyhole size={13} />}{t(wiki?.sync ? "wiki.automatic_sync" : "wiki.local_wiki")}</span><WikiIconButton label={t("wiki.refresh")} disabled={busy} onClick={() => void run(async () => { if (wiki?.sync) await props.client?.syncWiki(wiki.id); refresh(); })}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /></WikiIconButton></div>
          </div>
        </aside> : null}
        {!navigationOnly ? <main className="wiki-main">
          <header className="wiki-context-bar">
            {!tabOnly ? <WikiIconButton label={t("wiki.toggle_navigation")} pressed={navigationOpen} onClick={() => setNavigationOpen((open) => !open)}><PanelLeft size={17} /></WikiIconButton> : null}
            <nav className="wiki-location" aria-label={t("wiki.breadcrumb")} title={surface === "page" ? path : undefined}>
              {tabOnly ? <><span className="wiki-location-folder">{wiki?.name}</span><ChevronRight size={12} /></> : null}
              {surface === "page" && path.includes("/") ? <><span className="wiki-location-folder">{path.slice(0, path.lastIndexOf("/"))}</span><ChevronRight size={12} /></> : null}
              <span className="wiki-location-title">{surface === "graph" ? t("wiki.graph") : selectedView?.name ?? currentPage?.title ?? wiki?.name}</span>
            </nav>
            <div className="wiki-context-actions">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={busy || !wiki} className="wiki-agent-trigger" aria-label={t("wiki.ask_agent")} />}><Sparkles size={15} /><span>{t("wiki.ask_agent")}</span><ChevronDown size={12} /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-60">
                  <DropdownMenuItem onClick={() => void run(() => startSession())}><Sparkles size={15} />{t("wiki.agent_session")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Bootstrap.md", "help me build useful wiki knowledge from selected documents. First establish the topic and source scope.")))}>{t("wiki.extract")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Capture.md", "help capture reusable learning from this matter. First establish the source work.")))}>{t("wiki.capture")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void run(() => startSession(wikiProcedurePrompt(pages, "Skills/Maintain.md", "maintain this wiki within the requested scope. First establish the scope and sources.")))}>{t("wiki.maintain")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" className="wiki-share-trigger" aria-label={t("wiki.sharing")} disabled={!wiki} onClick={() => openSettings("sharing")}><Users size={15} /><span>{t("wiki.sharing")}</span></Button>
              <WikiIconButton label={t("wiki.settings")} disabled={!wiki} onClick={() => openSettings()}><Settings2 size={16} /></WikiIconButton>
            </div>
          </header>
          {snapshot.error ? <EmptyWiki message={wikiError(snapshot.error)} action={<Button variant="outline" onClick={() => void snapshot.refetch()}>{t("wiki.retry")}</Button>} /> : snapshot.isLoading ? <WikiLoading /> : surface.startsWith("view:") && !selectedView ? <EmptyWiki message={t("wiki.view_unavailable")} action={<Button variant="outline" onClick={() => openPage("Views.md")}>{t("wiki.edit_view")}</Button>} /> : surface === "graph" ? <WikiGraphPane pages={pages} focus={path || null} onOpen={openPage} /> : selectedView ? <WikiViewPane view={selectedView} pages={pages} writable={Boolean(wiki?.writable)} key={selectedView.name} onOpen={openPage} onMove={async (pagePath, property, value) => {
            if (!props.client || !wiki) return;
            const pending = drafts.get(wiki.id, pagePath);
            if (pending && pending.content !== pending.baseline) throw new Error(t("wiki.save_before_move"));
            const doc = await props.client.readWikiPage(wiki.id, pagePath);
            await props.client.writeWikiPage(wiki.id, { path: pagePath, content: updateWikiProperty(doc.content, property, value), baseRevision: doc.revision });
            await drafts.load(wiki.id, pagePath); refresh();
          }} /> : <>
            {wiki ? <div className="wiki-page-toolbar" role="toolbar" aria-label={t("wiki.page_actions")}>
              <div className="wiki-mode-tabs">
                <Button size="sm" variant="ghost" aria-pressed={mode === "preview"} className={mode === "preview" ? "is-active" : ""} onClick={() => setMode("preview")}><Eye size={14} />{t("wiki.preview")}</Button>
                {richAllowed ? <Button size="sm" variant="ghost" aria-pressed={mode === "rich"} className={mode === "rich" ? "is-active" : ""} onClick={() => setMode("rich")}><Pencil size={14} />{t("wiki.rich_editor")}</Button> : null}
                <Button size="sm" variant="ghost" aria-pressed={mode === "source"} className={mode === "source" ? "is-active" : ""} onClick={() => setMode("source")}><Code2 size={14} />{t("wiki.markdown")}</Button>
              </div>
              <div className="wiki-save-status" role="status" aria-live="polite">{draft ? draft.saving ? <><Loader2 size={13} className="animate-spin" />{t("wiki.saving")}</> : dirty ? <Button size="sm" variant="ghost" disabled={!wiki.writable} onClick={() => void drafts.save(wiki.id, path)}><Save size={13} />{t("wiki.save")}</Button> : <><Check size={13} />{t("wiki.saved")}</> : null}</div>
              {draft ? <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t("wiki.page_options")} title={t("wiki.page_options")} />}><MoreHorizontal size={17} /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem onClick={() => { setHistoryPath(path); setHistory(true); }}><History size={15} />{t("wiki.history")}</DropdownMenuItem>
                  {wiki.writable ? <DropdownMenuItem disabled={busy} onClick={() => uploadInput.current?.click()}><Paperclip size={15} />{t("wiki.attach_file")}</DropdownMenuItem> : null}
                  <DropdownMenuItem onClick={() => { setMode("source"); }}><Code2 size={15} />{t("wiki.markdown")}</DropdownMenuItem>
                  {wiki.writable ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" disabled={busy || draft.saving} onClick={() => setDeleteConfirm(true)}><Trash2 size={15} />{t("wiki.delete_page")}</DropdownMenuItem></> : null}
                </DropdownMenuContent>
              </DropdownMenu> : null}
            </div> : null}
            {deleteConfirm && wiki && draft ? <div className="wiki-notice wiki-delete-notice" role="alert"><span>{t("wiki.delete_page_question", { title: currentPage?.title ?? path })}</span><Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(false)}>{t("wiki.cancel")}</Button><Button size="sm" variant="destructive" disabled={busy || draft.saving} onClick={() => void run(async () => { await props.client?.deleteWikiPage(wiki.id, { path, baseRevision: draft.revision }); drafts.remove(wiki.id, path); openPage(""); refresh(); })}>{t("wiki.delete_confirm")}</Button></div> : null}
            {draft?.error ? <div role="alert" className="wiki-notice wiki-error-notice"><span>{draft.error} {t("wiki.draft_preserved")}</span><Button size="sm" variant="outline" onClick={() => void drafts.save(wikiId, path)}>{t("wiki.retry")}</Button><Button size="sm" variant="outline" onClick={() => { if (!props.client || !wiki) return; void run(async () => { const copyPath = `${path.replace(/\.md$/i, "")}-draft-${Date.now()}.md`; await props.client?.writeWikiPage(wiki.id, { path: copyPath, content: draft.content }); drafts.remove(wiki.id, path); openPage(copyPath); refresh(); }); }}>{t("wiki.save_copy")}</Button><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("wiki.discard_confirm"))) void run(() => drafts.load(wikiId, path, true)); }}>{t("wiki.reload_saved")}</Button></div> : null}
            {pageError ? <EmptyWiki message={pageError} action={<Button variant="outline" onClick={() => { setHistoryPath(path); setHistory(true); }}>{t("wiki.history")}</Button>} /> : documentLoading && !draft ? <WikiLoading /> : draft ? <>
              <div className="wiki-page-content" key={`${wikiId}:${path}:${mode}`}>
                {mode === "source" ? <WikiSourceEditor key={`${wikiId}:${path}`} value={draft.content} readOnly={!wiki?.writable} onChange={(content) => drafts.change(wikiId, path, content)} onSave={() => void drafts.save(wikiId, path)} /> : mode === "rich" ? <Suspense fallback={<WikiLoading />}><RichEditor key={`${wikiId}:${path}`} value={draft.content} baseline={draft.baseline} onChange={(content) => drafts.change(wikiId, path, content)} readOnly={!wiki?.writable} imageUpload={uploadImage} imagePreview={imagePreview} /></Suspense> : <>
                  {currentPage && Object.keys(currentPage.properties).some((key) => key !== "id") ? <details className="wiki-properties"><summary><ListFilter size={14} /><span>{t("wiki.properties")}</span><span className="wiki-count">{Object.keys(currentPage.properties).filter((key) => key !== "id").length}</span></summary><dl>{Object.entries(currentPage.properties).filter(([key]) => key !== "id").map(([key, value]) => <div key={key}><dt>{key}</dt><dd><WikiPropertyValue value={value} pages={pages} fromPath={path} onOpen={openPage} /></dd></div>)}</dl></details> : null}
                  <WikiPreview content={draft.content} path={path} anchor={pageAnchor} pages={pages} onOpen={openPage} onMissing={(target) => { if (wiki?.writable) setNewPage(target.split("#")[0]); else toast.error(t("wiki.missing_link")); }} onAsset={(assetPath) => void run(() => openAsset(assetPath))} imagePreview={imagePreview} />
                  {backlinks.length ? <section className="wiki-backlinks"><h2>{t("wiki.backlinks")}</h2>{backlinks.map((page) => <button key={page.path} onClick={() => openPage(page.path)}><FileText size={14} /><span>{page.title}</span><ArrowUpRight size={13} /></button>)}</section> : null}
                </>}
              </div>
              <footer className="wiki-document-footer"><span title={path}>{path}</span><span>{t(wiki?.writable ? "wiki.autosave_hint" : "wiki.read_only")}</span></footer>
            </> : <EmptyWiki message={t("wiki.empty_pages")} action={<Button disabled={!wiki?.writable} onClick={() => setNewPage("")}>{t("wiki.new_page")}</Button>} />}
          </>}
          {snapshot.data?.warnings.length ? <details className="wiki-warnings"><summary>{t("wiki.warnings", { count: snapshot.data.warnings.length })}</summary><ul>{snapshot.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
        </main> : null}
      </div>
    </>}
    <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { const files = [...event.target.files ?? []]; event.target.value = ""; if (!files.length) return; void run(async () => { for (const file of files) { const uploaded = await uploadAsset(file); if (draft) { const latest = drafts.get(wikiId, path); if (latest) drafts.change(wikiId, path, `${latest.content}\n\n[${file.name.replace(/[\[\]]/g, "")}](${uploaded.split("/").map(encodeURIComponent).join("/")})\n`); } } toast.success(t("wiki.uploaded")); }); }} />
    {newWiki && props.client ? <CreateWikiDialog client={props.client} serverUrl={props.serverUrl} wikis={list.data?.items ?? []} onClose={() => setNewWiki(false)} onCreate={async (input) => { const result = await props.client?.createWiki(input); if (!result) return; setNewWiki(false); chooseWiki(result.wiki.id); acceptWiki(result.wiki); setSharingActionError(result.sharingError ? { wikiId: result.wiki.id, message: result.sharingError } : null); props.onWikisChanged?.(); }} onJoin={async (input) => { const result = await props.client?.joinWiki(input); if (!result) return; setNewWiki(false); chooseWiki(result.wiki.id); acceptWiki(result.wiki); props.onWikisChanged?.(); }} /> : null}
    {settings && props.client && wiki ? <WikiSettingsDialog key={wiki.id} initialTab={settingsTab} client={props.client} serverUrl={props.serverUrl} wiki={wiki} projectWorkspaces={props.workspaces.filter((workspace) => !list.data?.items.some((item) => item.workspaceId === workspace.id))} onClose={() => setSettings(false)} onUpdate={async (input) => { const result = await props.client?.updateWiki(wiki.id, input); if (result) acceptWiki(result.wiki); setSettings(false); }} onShare={async (input, update) => { const result = update ? await props.client?.updateWikiSharing(wiki.id, input) : await props.client?.shareWiki(wiki.id, input); if (result) { acceptWiki(result.wiki); setSharingActionError(null); } }} onStopSharing={async () => { const result = await props.client?.stopWikiSharing(wiki.id); if (result) { acceptWiki(result.wiki); setSharingActionError(null); } }} onForget={async () => { if (drafts.dirty.some((item) => item.wikiId === wiki.id)) throw new Error(t("wiki.save_before_forget")); await props.client?.forgetWiki(wiki.id); setSettings(false); if (tabOnly) props.onCloseTab?.(); else chooseWiki(""); refresh(); }} /> : null}
    {newPage !== null && props.client && wiki ? <NewWikiPageDialog key={`${wiki.id}:${newPage}`} pages={pages} initialPath={newPage} onClose={() => setNewPage(null)} onCreate={async (newPath, templatePath) => { if (pages.some((page) => page.path.toLocaleLowerCase() === newPath.toLocaleLowerCase())) throw new Error(t("wiki.page_exists")); let content = `# ${newPath.split("/").at(-1)?.replace(/\.md$/i, "")}\n\n`; if (templatePath) { const template = await props.client?.readWikiPage(wiki.id, templatePath); const page = pages.find((entry) => entry.path === templatePath); if (template && page) content = wikiTemplateContent(template.content, page, newPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? newPath); } await props.client?.writeWikiPage(wiki.id, { path: newPath, content }); setNewPage(null); setMode("source"); openPage(newPath, "", "source"); refresh(); }} /> : null}
    {history && props.client && wiki ? <WikiHistoryDialog key={`${wiki.id}:${historyPath}`} client={props.client} serverUrl={props.serverUrl} writable={wiki.writable} wikiId={wiki.id} initialPath={historyPath} onClose={() => setHistory(false)} onRestore={async (restorePath, revisionId) => { if (drafts.get(wiki.id, restorePath)?.content !== drafts.get(wiki.id, restorePath)?.baseline) throw new Error(t("wiki.save_before_restore")); let baseRevision: string | undefined; try { baseRevision = (await props.client?.readWikiPage(wiki.id, restorePath))?.revision; } catch (error) { if (!(error instanceof LegalworkServerError && error.status === 404)) throw error; } await props.client?.restoreWikiPage(wiki.id, { path: restorePath, revisionId, baseRevision }); await drafts.load(wiki.id, restorePath, true); refresh(); toast.success(t("wiki.restored")); }} /> : null}
  </div>;
}

function WikiSourceEditor(props: { value: string; readOnly: boolean; onChange: (content: string) => void; onSave: () => void }) {
  const region = useRef<HTMLDivElement>(null);
  const label = t("wiki.markdown");
  useEffect(() => { region.current?.querySelector(".cm-content")?.setAttribute("aria-label", label); }, [label]);
  return <div ref={region} className="wiki-source" role="region" aria-label={label} onKeyDownCapture={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); if (!props.readOnly) props.onSave(); } }}><ArtifactTextEditor className="wiki-source-editor" language="markdown" value={props.value} readOnly={props.readOnly} onChange={props.onChange} /></div>;
}

function EmptyWiki(props: { title?: string; message: string; action?: React.ReactNode }) {
  return <div className="wiki-empty"><BookOpen size={32} strokeWidth={1.3} aria-hidden="true" />{props.title ? <h2>{props.title}</h2> : null}<p>{props.message}</p>{props.action}</div>;
}

function WikiLoading() {
  return <div className="wiki-loading" role="status"><Loader2 size={18} className="animate-spin" /><span>{t("wiki.loading")}</span></div>;
}

function WikiIconButton(props: { label: string; disabled?: boolean; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="ghost" className="wiki-icon-button" aria-label={props.label} aria-pressed={props.pressed} disabled={props.disabled} onClick={props.onClick} />}>{props.children}</TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>;
}

function PageRow(props: { page: WikiPage; active: boolean; onOpen: (path: string) => void }) {
  return <button className={cn("wiki-nav-row", props.active && "is-active")} aria-current={props.active ? "page" : undefined} title={props.page.path} onClick={() => props.onOpen(props.page.path)}><FileText size={14} /><span>{props.page.title}</span></button>;
}

function PageTree(props: { pages: WikiPage[]; active: string; onOpen: (path: string) => void; searching: boolean }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [limit, setLimit] = useState(100);
  const visible = useMemo(() => wikiNavigationPages(props.pages, props.active, limit), [props.pages, props.active, limit]);
  useEffect(() => {
    const folder = props.active.slice(0, props.active.lastIndexOf("/"));
    if (!props.active.includes("/")) return;
    setCollapsed((current) => { if (!current.has(folder)) return current; const next = new Set(current); next.delete(folder); return next; });
  }, [props.active]);
  const groups = useMemo(() => {
    const map = new Map<string, WikiPage[]>();
    for (const page of visible) { const folder = page.path.includes("/") ? page.path.slice(0, page.path.lastIndexOf("/")) : ""; const group = map.get(folder); if (group) group.push(page); else map.set(folder, [page]); }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);
  const more = props.pages.length > limit ? <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => setLimit((current) => current + 100)}>{t("wiki.show_more", { remaining: props.pages.length - limit })}</Button> : null;
  if (props.searching) return <>{visible.map((page) => <PageRow key={page.path} page={page} active={props.active === page.path} onOpen={props.onOpen} />)}{more}</>;
  return <>{groups.map(([folder, pages]) => <div className="wiki-tree-group" key={folder}>{folder ? <button className="wiki-tree-folder" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })} aria-expanded={!collapsed.has(folder)}>{collapsed.has(folder) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={14} /><span>{folder}</span></button> : null}{!collapsed.has(folder) ? <div className={folder ? "wiki-tree-children" : undefined}>{pages.map((page) => <PageRow key={page.path} page={page} active={props.active === page.path} onOpen={props.onOpen} />)}</div> : null}</div>)}{more}</>;
}
