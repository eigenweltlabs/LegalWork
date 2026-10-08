import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, ChevronsDownUp, Copy, Download, FilePlus2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, GitFork, History, Link, Pencil, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FileBrowserRow } from "@/react-app/design-system/file-browser-row";
import { FolderIcon } from "@/react-app/design-system/folder-icon";
import { ArtifactIcon } from "../session/artifacts/artifact-icon";
import { classifyOpenTarget } from "../session/artifacts/open-target";
import { t } from "@/i18n";
import { isWindowsPlatform } from "@/app/utils";
import { wikiTree, type WikiTreeEntry, type WikiTreeNode } from "./wiki-tree";

export type WikiExplorerAction = "rename" | "move" | "copy" | "trash" | "history" | "download" | "copy-path" | "copy-link" | "edit" | "reveal";

export function WikiExplorerButton(props: { label: string; disabled?: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="ghost" className="wiki-icon-button" aria-label={props.label} aria-pressed={props.pressed} disabled={props.disabled} onClick={props.onClick} />}>{props.children}</TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>;
}

export function WikiExplorer(props: {
  files: string[]; folders: string[]; searchFiles: string[]; active: string; writable: boolean; busy: boolean; revealable: boolean;
  search: string; searching: boolean; onSearch: (value: string) => void;
  onOpen: (path: string) => void; onNewPage: (folder: string) => void; onNewFolder: (folder: string) => void;
  onGraph: () => void; onAction: (entry: WikiTreeEntry, action: WikiExplorerAction) => void; children?: ReactNode;
}) {
  const tree = useMemo(() => wikiTree(props.files, props.folders), [props.files, props.folders]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    if (!props.active.includes("/")) return;
    const parts = props.active.split("/");
    setExpanded((current) => {
      const next = new Set(current);
      for (let index = 1; index < parts.length; index++) next.add(parts.slice(0, index).join("/"));
      return next;
    });
  }, [props.active]);
  const toggleFolder = (path: string) => setExpanded((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const menu = (entry: WikiTreeEntry, row: ReactNode) => <ContextMenu key={entry.path}>
    <ContextMenuTrigger render={<div className="wiki-tree-target" />} onContextMenu={(event) => event.stopPropagation()}>{row}</ContextMenuTrigger>
    <ContextMenuContent>
      {entry.kind === "folder" ? <>
        <ContextMenuItem onClick={() => toggleFolder(entry.path)}><Folder size={15} />{t(expanded.has(entry.path) ? "wiki.collapse_folder" : "wiki.expand_folder")}</ContextMenuItem>
        <ContextMenuItem disabled={!props.writable || props.busy} onClick={() => props.onNewPage(entry.path)}><FilePlus2 size={15} />{t("wiki.new_page")}</ContextMenuItem>
        <ContextMenuItem disabled={!props.writable || props.busy} onClick={() => { setExpanded((current) => new Set([...current, entry.path])); props.onNewFolder(entry.path); }}><FolderPlus size={15} />{t("wiki.new_folder")}</ContextMenuItem>
      </> : <>
        <ContextMenuItem onClick={() => props.onOpen(entry.path)}><FileText size={15} />{t("wiki.open_file")}</ContextMenuItem>
        {/\.md$/i.test(entry.path) ? <ContextMenuItem onClick={() => props.onAction(entry, "edit")}><Pencil size={15} />{t("wiki.edit_markdown")}</ContextMenuItem> : null}
      </>}
      {props.revealable ? <ContextMenuItem onClick={() => props.onAction(entry, "reveal")}><FolderOpen size={15} />{t(isWindowsPlatform() ? "workspace_list.reveal_explorer" : "workspace_list.reveal_finder")}</ContextMenuItem> : null}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!props.writable || props.busy} onClick={() => props.onAction(entry, "rename")}><Pencil size={15} />{t("wiki.rename")}</ContextMenuItem>
      <ContextMenuItem disabled={!props.writable || props.busy} onClick={() => props.onAction(entry, "move")}><FolderInput size={15} />{t("wiki.move")}</ContextMenuItem>
      <ContextMenuItem disabled={!props.writable || props.busy} onClick={() => props.onAction(entry, "copy")}><Copy size={15} />{t("wiki.duplicate")}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => props.onAction(entry, "copy-path")}><Copy size={15} />{t("wiki.copy_path")}</ContextMenuItem>
      {entry.kind === "file" ? <>
        {/\.md$/i.test(entry.path) ? <><ContextMenuItem onClick={() => props.onAction(entry, "copy-link")}><Link size={15} />{t("wiki.copy_link")}</ContextMenuItem><ContextMenuItem onClick={() => props.onAction(entry, "history")}><History size={15} />{t("wiki.history")}</ContextMenuItem></> : null}
        <ContextMenuItem onClick={() => props.onAction(entry, "download")}><Download size={15} />{t("wiki.download_file")}</ContextMenuItem>
      </> : null}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!props.writable || props.busy} onClick={() => props.onAction(entry, "trash")}><Trash2 size={15} />{t("wiki.move_to_trash")}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
  const file = (entry: WikiTreeEntry, depth: number, name: string) => menu(entry, <FileBrowserRow selected={props.active === entry.path} style={{ paddingLeft: 6 + depth * 15 }} aria-current={props.active === entry.path ? "page" : undefined} title={entry.path} onClick={() => props.onOpen(entry.path)} leading={<span className="size-3.5 shrink-0" />} icon={<ArtifactIcon type={classifyOpenTarget(entry.path, "file")} className="size-5" />}>{name}</FileBrowserRow>);
  let shown = 0;
  let total = 0;
  const rows: ReactNode[] = [];
  const visit = (nodes: WikiTreeNode[], depth: number) => {
    for (const node of nodes) {
      total++;
      if (shown < limit) {
        shown++;
        if (node.kind === "file") rows.push(file(node, depth, node.name));
        else rows.push(menu(node, <FileBrowserRow style={{ paddingLeft: 6 + depth * 15 }} aria-expanded={expanded.has(node.path)} title={node.path} onClick={() => toggleFolder(node.path)} leading={<ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded.has(node.path) && "rotate-90")} />} icon={<FolderIcon open={expanded.has(node.path)} />}>{node.name}</FileBrowserRow>));
      }
      if (node.kind === "folder" && expanded.has(node.path)) visit(node.children, depth + 1);
    }
  };
  if (!props.searching) visit(tree, 0);
  return <>
    <div className="flex h-(--lw-panel-toolbar-height) shrink-0 items-center justify-end gap-0.5 border-b border-border/70 bg-background/80 px-2 backdrop-blur-xl" role="toolbar" aria-label={t("wiki.file_actions")}>
      <WikiExplorerButton label={t("wiki.new_page")} disabled={!props.writable || props.busy} onClick={() => props.onNewPage("")}><FilePlus2 size={16} /></WikiExplorerButton>
      <WikiExplorerButton label={t("wiki.new_folder")} disabled={!props.writable || props.busy} onClick={() => props.onNewFolder("")}><FolderPlus size={16} /></WikiExplorerButton>
      <WikiExplorerButton label={t("wiki.search")} pressed={searchOpen} onClick={() => { setSearchOpen((open) => !open); props.onSearch(""); }}><Search size={16} /></WikiExplorerButton>
      <WikiExplorerButton label={t("wiki.graph")} onClick={props.onGraph}><GitFork size={16} /></WikiExplorerButton>
      <WikiExplorerButton label={t("wiki.collapse_all")} onClick={() => setExpanded(new Set())}><ChevronsDownUp size={16} /></WikiExplorerButton>
    </div>
    {searchOpen ? <div className="wiki-explorer-search"><Input autoFocus aria-label={t("wiki.search")} placeholder={t("wiki.search")} value={props.search} onChange={(event) => { setLimit(100); props.onSearch(event.target.value); }} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); props.onSearch(""); } }} /><WikiExplorerButton label={t("wiki.clear_search")} onClick={() => { setSearchOpen(false); props.onSearch(""); }}><X size={14} /></WikiExplorerButton></div> : null}
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
      <nav aria-label={t("wiki.files")} className="wiki-explorer-tree">{props.searching ? props.searchFiles.slice(0, limit).map((path) => file({ path, kind: "file" }, 0, path.replace(/\.md$/i, ""))) : rows}
        {(props.searching ? props.searchFiles.length : total) > limit ? <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit((current) => current + 100)}>{t("wiki.show_more", { remaining: (props.searching ? props.searchFiles.length : total) - limit })}</Button> : null}
      </nav>
      {props.children}
    </div>
  </>;
}
