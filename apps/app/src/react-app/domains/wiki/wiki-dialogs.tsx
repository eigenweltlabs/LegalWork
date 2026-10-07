import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2, RotateCcw } from "lucide-react";
import type { WikiCreateInput, WikiPage, WikiSyncSettings, WikiUpdateInput, WikiVault } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { pickDirectory } from "@/app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { wikiNewPagePath } from "./wiki-model";

export type WikiWorkspaceOption = { id: string; displayNameResolved: string };
export const wikiSelectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const wikiError = (error: unknown) => error instanceof Error ? error.message : String(error);

function SharingFields(props: { client: LegalworkServerClient; workspaces: WikiWorkspaceOption[]; value: WikiSyncSettings | null; onChange: (value: WikiSyncSettings | null) => void; defaultWorkspaceId: string }) {
  const [shared, setShared] = useState(Boolean(props.value));
  const [workspaceId, setWorkspaceId] = useState(props.value?.workspaceId ?? props.defaultWorkspaceId);
  const roots = useQuery({ queryKey: ["wiki-storage-roots", workspaceId], queryFn: () => props.client.storageRoots(workspaceId), enabled: shared && Boolean(workspaceId) });
  const choices = roots.data?.roots.filter((root) => root.writable) ?? [];
  const update = (input: Partial<WikiSyncSettings>) => props.onChange({
    workspaceId, connectionId: props.value?.connectionId ?? "", path: props.value?.path ?? "", ...input,
  });
  return <div className="space-y-3">
    <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(event) => { setShared(event.target.checked); props.onChange(event.target.checked ? { workspaceId, connectionId: "", path: "" } : null); }} />{t("wiki.share")}</label>
    {shared ? <>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("wiki.share_hint")}</p>
      <label className="grid gap-1.5 text-sm">{t("wiki.connection_workspace")}<select className={wikiSelectClass} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); update({ workspaceId: event.target.value, connectionId: "" }); }}><option value="">{t("wiki.select_workspace")}</option>{props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.displayNameResolved}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm">{t("wiki.connection")}<select className={wikiSelectClass} value={props.value?.connectionId ?? ""} onChange={(event) => update({ connectionId: event.target.value })} disabled={roots.isLoading}><option value="">{t("wiki.select_connection")}</option>{choices.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}</select></label>
      {roots.error ? <p className="text-xs text-destructive">{wikiError(roots.error)}</p> : !roots.isLoading && choices.length === 0 ? <p className="text-xs text-muted-foreground">{t("wiki.no_connections")}</p> : null}
      <label className="grid gap-1.5 text-sm">{t("wiki.shared_path")}<Input value={props.value?.path ?? ""} onChange={(event) => update({ path: event.target.value })} placeholder="Knowledge/Firm wiki" /></label>
    </> : null}
  </div>;
}

export function CreateWikiDialog(props: { client: LegalworkServerClient; workspaces: WikiWorkspaceOption[]; defaultWorkspaceId: string; onClose: () => void; onCreate: (input: WikiCreateInput) => Promise<void> }) {
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [template, setTemplate] = useState<"firm" | "blank">("firm");
  const [sync, setSync] = useState<WikiSyncSettings | null>(null);
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await props.onCreate({ name: name.trim(), ...(root.trim() ? { root: root.trim() } : {}), template, sync, attach: Boolean(sync && attach) }); }
    catch (err) { setError(wikiError(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><form onSubmit={submit} className="space-y-5"><DialogHeader><DialogTitle>{t("wiki.new_wiki")}</DialogTitle><DialogDescription>{t("wiki.new_wiki_hint")}</DialogDescription></DialogHeader>
    <label className="grid gap-1.5 text-sm">{t("wiki.name")}<Input autoFocus required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder={t("wiki.name_placeholder")} /></label>
    <label className="grid gap-1.5 text-sm">{t("wiki.folder")}<div className="flex gap-2"><Input value={root} onChange={(event) => setRoot(event.target.value)} placeholder={t("wiki.default_folder")} /><Button type="button" variant="outline" size="icon" aria-label={t("wiki.choose_folder")} onClick={() => { void pickDirectory({ title: t("wiki.choose_folder") }).then((value) => { if (typeof value === "string") setRoot(value); }).catch((err) => setError(wikiError(err))); }}><FolderOpen size={16} /></Button></div><span className="text-xs leading-relaxed text-muted-foreground">{t("wiki.folder_hint")}</span></label>
    <label className="grid gap-1.5 text-sm">{t("wiki.starter")}<select className={wikiSelectClass} value={template} onChange={(event) => setTemplate(event.target.value === "blank" ? "blank" : "firm")}><option value="firm">{t("wiki.firm_starter")}</option><option value="blank">{t("wiki.blank_starter")}</option></select></label>
    <SharingFields client={props.client} workspaces={props.workspaces} defaultWorkspaceId={props.defaultWorkspaceId} value={sync} onChange={setSync} />
    {sync ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={attach} onChange={(event) => setAttach(event.target.checked)} /><span>{t("wiki.join_existing")}<span className="mt-1 block text-xs text-muted-foreground">{t("wiki.join_existing_hint")}</span></span></label> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button type="button" variant="ghost" onClick={props.onClose} disabled={busy}>{t("wiki.cancel")}</Button><Button type="submit" disabled={busy || !name.trim() || Boolean(sync && (!sync.workspaceId || !sync.connectionId || !sync.path.trim()))}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{t("wiki.create")}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

export function WikiSettingsDialog(props: { client: LegalworkServerClient; wiki: WikiVault; workspaces: WikiWorkspaceOption[]; projectWorkspaces: WikiWorkspaceOption[]; onClose: () => void; onUpdate: (input: WikiUpdateInput) => Promise<void>; onForget: () => Promise<void> }) {
  const [name, setName] = useState(props.wiki.name);
  const [allowInProjects, setAllowInProjects] = useState(props.wiki.allowInProjects);
  const [projectWorkspaceIds, setProjectWorkspaceIds] = useState<string[] | null>(props.wiki.projectWorkspaceIds ?? null);
  const [sync, setSync] = useState(props.wiki.sync);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(null); try { await operation(); } catch (err) { setError(wikiError(err)); } finally { setBusy(false); } };
  const workspaceChoices = props.workspaces.some((workspace) => workspace.id === props.wiki.workspaceId) ? props.workspaces : [...props.workspaces, { id: props.wiki.workspaceId, displayNameResolved: props.wiki.name }];
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void run(() => props.onUpdate({ name: name.trim(), allowInProjects, projectWorkspaceIds, sync })); }}><DialogHeader><DialogTitle>{t("wiki.settings")}</DialogTitle><DialogDescription>{props.wiki.root}</DialogDescription></DialogHeader>
    <label className="grid gap-1.5 text-sm">{t("wiki.name")}<Input required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowInProjects} onChange={(event) => setAllowInProjects(event.target.checked)} className="mt-1" /><span>{t("wiki.project_access")}<span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t("wiki.project_access_hint")}</span></span></label>
    {allowInProjects ? <div className="space-y-3 rounded-lg border p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={projectWorkspaceIds === null} onChange={(event) => setProjectWorkspaceIds(event.target.checked ? null : [])} />{t("wiki.all_projects")}</label>{projectWorkspaceIds !== null ? <div className="max-h-40 space-y-2 overflow-y-auto">{props.projectWorkspaces.length ? props.projectWorkspaces.map((workspace) => <label key={workspace.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={projectWorkspaceIds.includes(workspace.id)} onChange={(event) => setProjectWorkspaceIds((current) => event.target.checked ? [...current ?? [], workspace.id] : (current ?? []).filter((id) => id !== workspace.id))} />{workspace.displayNameResolved}</label>) : <p className="text-xs text-muted-foreground">{t("wiki.no_projects")}</p>}</div> : null}</div> : null}
    <SharingFields client={props.client} workspaces={workspaceChoices} defaultWorkspaceId={props.wiki.workspaceId} value={sync} onChange={setSync} />
    <p className="text-xs text-muted-foreground">{t("wiki.storage_size", { pages: props.wiki.pageCount, size: formatWikiSize(props.wiki.totalBytes) })}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="ghost" type="button" onClick={props.onClose}>{t("wiki.cancel")}</Button><Button disabled={busy || !name.trim() || Boolean(sync && (!sync.workspaceId || !sync.connectionId || !sync.path.trim()))} type="submit">{busy ? <Loader2 size={16} className="animate-spin" /> : null}{t("wiki.save")}</Button></DialogFooter>
    <div className="border-t pt-4"><p className="mb-2 text-xs text-muted-foreground">{t("wiki.forget_hint")}</p><Button size="sm" variant="ghost" className="text-destructive" type="button" disabled={busy} onClick={() => { if (removeConfirm) void run(props.onForget); else setRemoveConfirm(true); }}>{t(removeConfirm ? "wiki.forget_confirm" : "wiki.forget")}</Button></div>
  </form></DialogContent></Dialog>;
}

export function NewWikiPageDialog(props: { pages: WikiPage[]; initialPath?: string; onClose: () => void; onCreate: (path: string, templatePath: string | null) => Promise<void> }) {
  const [path, setPath] = useState(props.initialPath ?? "");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templates = props.pages.filter((page) => /^Templates\//i.test(page.path) || page.type === "template");
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}><DialogContent><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); setError(null); setBusy(true); void Promise.resolve().then(() => props.onCreate(wikiNewPagePath(path), template || null)).catch((err) => setError(wikiError(err))).finally(() => setBusy(false)); }}><DialogHeader><DialogTitle>{t("wiki.new_page")}</DialogTitle><DialogDescription>{t("wiki.new_page_hint")}</DialogDescription></DialogHeader>
    <label className="grid gap-1.5 text-sm">{t("wiki.page_path")}<Input autoFocus required value={path} onChange={(event) => setPath(event.target.value)} placeholder="Processes/Financing.md" /></label>
    {templates.length ? <label className="grid gap-1.5 text-sm">{t("wiki.template")}<select className={wikiSelectClass} value={template} onChange={(event) => setTemplate(event.target.value)}><option value="">{t("wiki.no_template")}</option>{templates.map((page) => <option key={page.path} value={page.path}>{page.title}</option>)}</select></label> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="ghost" type="button" onClick={props.onClose} disabled={busy}>{t("wiki.cancel")}</Button><Button type="submit" disabled={busy || !path.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{t("wiki.create")}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

export function formatWikiSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export function WikiHistoryDialog(props: { client: LegalworkServerClient; wikiId: string; initialPath: string; onClose: () => void; onRestore: (path: string, revisionId: string) => Promise<void> }) {
  const [path, setPath] = useState(props.initialPath);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["wiki-history", props.wikiId, path], queryFn: () => props.client.wikiHistory(props.wikiId, path) });
  return <Dialog open onOpenChange={(open) => { if (!open && !busyId) props.onClose(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{t("wiki.history")}</DialogTitle><DialogDescription>{t("wiki.history_hint")}</DialogDescription></DialogHeader>
    <Label className="grid gap-2">{t("wiki.page_path")}<Input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t("wiki.all_history")} /></Label>
    <div className="max-h-[45vh] space-y-2 overflow-y-auto">
      {history.isLoading ? <Loader2 size={18} className="animate-spin" /> : null}
      {history.data?.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("wiki.no_history")}</p> : null}
      {history.data?.items.map((revision) => <div key={`${revision.path}/${revision.id}`} className="flex items-center gap-3 rounded-xl border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{revision.path}</p><p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()} · {t(`wiki.revision_${revision.action}`)} · {formatWikiSize(revision.size)}</p></div><Button variant="outline" size="sm" disabled={Boolean(busyId) || revision.action === "delete"} onClick={() => { setBusyId(revision.id); setError(null); void props.onRestore(revision.path, revision.id).then(() => history.refetch()).catch((err) => setError(wikiError(err))).finally(() => setBusyId(null)); }}>{busyId === revision.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}{t("wiki.restore")}</Button></div>)}
    </div>
    {error || history.error ? <p role="alert" className="text-sm text-destructive">{error ?? wikiError(history.error)}</p> : null}
  </DialogContent></Dialog>;
}
