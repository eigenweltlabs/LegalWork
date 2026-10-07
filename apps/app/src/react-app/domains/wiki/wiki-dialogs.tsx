import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2, RotateCcw, Users } from "lucide-react";
import type { WikiCreateInput, WikiPage, WikiSharingInput, WikiTeamOverview, WikiUpdateInput, WikiVault } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { pickDirectory } from "@/app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { wikiNewPagePath } from "./wiki-model";
import { joinedTeamWikiIds, wikiSharingError, wikiSharingInput, wikiSharingValid } from "./wiki-sharing";

export type WikiWorkspaceOption = { id: string; displayNameResolved: string };
export const wikiSelectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const wikiError = (error: unknown) => error instanceof Error ? error.message : String(error);

function TeamNotice(props: { loading: boolean; error: unknown; team: WikiTeamOverview | undefined; retry: () => void }) {
  if (props.loading) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />{t("wiki.loading_team")}</p>;
  if (props.error) return <div className="space-y-2 rounded-lg border bg-muted/30 p-3"><p role="alert" className="text-xs leading-relaxed text-muted-foreground">{wikiSharingError(props.error)}</p><Button type="button" size="sm" variant="outline" onClick={props.retry}>{t("wiki.retry")}</Button></div>;
  return props.team ? <p className="text-xs text-muted-foreground">{t("wiki.sharing_firm", { name: props.team.orgName ?? t("wiki.your_firm") })}</p> : null;
}

function AudienceFields(props: { team: WikiTeamOverview; value: WikiSharingInput; onChange: (value: WikiSharingInput) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const members = props.team.members.filter((member) => member.userId !== props.team.userId && `${member.name ?? ""} ${member.email ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="space-y-3">
    <label className="grid gap-1.5 text-sm">{t("wiki.audience")}<select className={wikiSelectClass} value={props.value.access} disabled={props.disabled} onChange={(event) => props.onChange({ ...props.value, access: event.target.value === "members" ? "members" : "org" })}><option value="org">{t("wiki.everyone_in_firm")}</option><option value="members">{t("wiki.selected_members")}</option></select></label>
    {props.value.access === "members" ? <div className="space-y-2 rounded-lg border p-3">
      {props.team.members.length > 10 ? <Input className="h-8 text-xs" placeholder={t("wiki.search_members")} value={search} onChange={(event) => { setSearch(event.target.value); setLimit(50); }} /> : null}
      <div className="max-h-40 space-y-2 overflow-y-auto">{members.slice(0, limit).map((member) => <label key={member.userId} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={props.value.memberIds.includes(member.userId)} disabled={props.disabled} onChange={(event) => props.onChange({ ...props.value, memberIds: event.target.checked ? [...props.value.memberIds, member.userId] : props.value.memberIds.filter((id) => id !== member.userId) })} /><span className="min-w-0"><span className="block truncate">{member.name || member.email || t("wiki.member")}</span>{member.name && member.email ? <span className="block truncate text-xs text-muted-foreground">{member.email}</span> : null}</span></label>)}{members.length === 0 ? <p className="text-xs text-muted-foreground">{t("wiki.no_members")}</p> : null}</div>
      {members.length > limit ? <Button type="button" variant="ghost" size="sm" onClick={() => setLimit((current) => current + 50)}>{t("wiki.show_more", { remaining: members.length - limit })}</Button> : null}
      <p className="text-xs text-muted-foreground">{t("wiki.owner_access")}</p>
    </div> : null}
  </div>;
}

function LocalFolderField(props: { value: string; onChange: (value: string) => void; onError: (message: string) => void }) {
  return <label className="grid gap-1.5 text-sm">{t("wiki.folder")}<div className="flex gap-2"><Input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={t("wiki.default_folder")} /><Button type="button" variant="outline" size="icon" aria-label={t("wiki.choose_folder")} onClick={() => { void pickDirectory({ title: t("wiki.choose_folder") }).then((value) => { if (typeof value === "string") props.onChange(value); }).catch((error) => props.onError(wikiError(error))); }}><FolderOpen size={16} /></Button></div><span className="text-xs leading-relaxed text-muted-foreground">{t("wiki.folder_hint")}</span></label>;
}

export function CreateWikiDialog(props: { client: LegalworkServerClient; serverUrl: string; wikis: WikiVault[]; onClose: () => void; onCreate: (input: WikiCreateInput) => Promise<void>; onJoin: (input: { wikiId: string; root?: string }) => Promise<void> }) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [shared, setShared] = useState(false);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [template, setTemplate] = useState<"firm" | "blank">("firm");
  const [sharing, setSharing] = useState<WikiSharingInput>(wikiSharingInput());
  const [joinId, setJoinId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = useQuery({ queryKey: ["wiki-team", props.serverUrl], queryFn: () => props.client.wikiTeam(), enabled: shared || tab === "join", retry: false });
  const joined = joinedTeamWikiIds(props.wikis);
  const valid = tab === "join" ? Boolean(joinId && team.data && !joined.has(joinId)) : Boolean(name.trim() && (!shared || wikiSharingValid(sharing, team.data)));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!valid) return;
    setBusy(true); setError(null);
    try {
      if (tab === "join") await props.onJoin({ wikiId: joinId, ...(root.trim() ? { root: root.trim() } : {}) });
      else await props.onCreate({ name: name.trim(), ...(root.trim() ? { root: root.trim() } : {}), template, ...(shared ? { sharing } : {}) });
    } catch (err) { setError(shared || tab === "join" ? wikiSharingError(err) : wikiError(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><form onSubmit={submit} className="space-y-5"><DialogHeader><DialogTitle>{t("wiki.new_wiki")}</DialogTitle><DialogDescription>{t(tab === "join" ? "wiki.join_team_hint" : "wiki.new_wiki_hint")}</DialogDescription></DialogHeader>
    <div className="flex rounded-lg border p-1"><Button type="button" className="flex-1" size="sm" variant={tab === "create" ? "secondary" : "ghost"} onClick={() => { setTab("create"); setError(null); }}>{t("wiki.create")}</Button><Button type="button" className="flex-1" size="sm" variant={tab === "join" ? "secondary" : "ghost"} onClick={() => { setTab("join"); setError(null); }}>{t("wiki.join_shared")}</Button></div>
    {tab === "create" ? <>
      <label className="grid gap-1.5 text-sm">{t("wiki.name")}<Input autoFocus required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder={t("wiki.name_placeholder")} /></label>
      <label className="grid gap-1.5 text-sm">{t("wiki.visibility")}<select className={wikiSelectClass} value={shared ? "shared" : "personal"} onChange={(event) => setShared(event.target.value === "shared")}><option value="personal">{t("wiki.personal")}</option><option value="shared">{t("wiki.shared")}</option></select></label>
      {shared ? <div className="space-y-3"><TeamNotice loading={team.isLoading} error={team.error} team={team.data} retry={() => void team.refetch()} />{team.data ? <AudienceFields team={team.data} value={sharing} onChange={setSharing} /> : null}<p className="text-xs leading-relaxed text-muted-foreground">{t("wiki.team_sync_hint")}</p></div> : null}
      <label className="grid gap-1.5 text-sm">{t("wiki.starter")}<select className={wikiSelectClass} value={template} onChange={(event) => setTemplate(event.target.value === "blank" ? "blank" : "firm")}><option value="firm">{t("wiki.firm_starter")}</option><option value="blank">{t("wiki.blank_starter")}</option></select></label>
    </> : <>
      <TeamNotice loading={team.isLoading} error={team.error} team={team.data} retry={() => void team.refetch()} />
      {team.data ? <div className="max-h-60 space-y-2 overflow-y-auto">{team.data.items.length ? team.data.items.map((item) => <label key={item.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${joined.has(item.id) ? "opacity-50" : ""}`}><input type="radio" name="join-wiki" value={item.id} checked={joinId === item.id} disabled={joined.has(item.id)} onChange={() => setJoinId(item.id)} /><Users size={16} className="shrink-0 text-muted-foreground" /><span className="min-w-0 text-sm"><span className="block truncate font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{joined.has(item.id) ? t("wiki.already_added") : t(item.access === "org" ? "wiki.everyone_in_firm" : "wiki.selected_members")}</span></span></label>) : <p className="text-sm text-muted-foreground">{t("wiki.no_shared_wikis")}</p>}</div> : null}
    </>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">{t("wiki.folder_options")}</summary><div className="pt-3"><LocalFolderField value={root} onChange={setRoot} onError={setError} /></div></details>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button type="button" variant="ghost" onClick={props.onClose} disabled={busy}>{t("wiki.cancel")}</Button><Button type="submit" disabled={busy || !valid}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{t(tab === "join" ? "wiki.join" : "wiki.create")}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function WikiSharingPanel(props: { client: LegalworkServerClient; serverUrl: string; wiki: WikiVault; busy: boolean; onShare: (input: WikiSharingInput, update: boolean) => Promise<void>; onStop: () => Promise<void>; onError: (message: string | null) => void }) {
  const [input, setInput] = useState<WikiSharingInput>(wikiSharingInput(props.wiki.pendingSharing ?? props.wiki.sharing));
  const [confirmStop, setConfirmStop] = useState(false);
  const [sharing, setSharing] = useState(false);
  const team = useQuery({ queryKey: ["wiki-team", props.serverUrl], queryFn: () => props.client.wikiTeam(), retry: false });
  const teamBinding = props.wiki.sync && "kind" in props.wiki.sync ? props.wiki.sync : null;
  const record = props.wiki.sharing ?? (teamBinding ? team.data?.items.find((item) => item.id === teamBinding.wikiId) : undefined);
  const legacy = Boolean(props.wiki.sync && !("kind" in props.wiki.sync));
  useEffect(() => { setInput(wikiSharingInput(props.wiki.pendingSharing ?? record)); }, [props.wiki.pendingSharing?.access, props.wiki.pendingSharing?.memberIds.join(","), record?.id, record?.access, record?.memberIds.join(",")]);
  const run = async (operation: () => Promise<void>) => { setSharing(true); props.onError(null); try { await operation(); } catch (error) { props.onError(wikiSharingError(error)); } finally { setSharing(false); } };
  const editable = (!record && !teamBinding) || record?.role === "owner";
  return <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">{t("wiki.sharing")}</h3>
    {record ? <p className="text-xs leading-relaxed text-muted-foreground">{t(record.access === "org" ? "wiki.shared_with_firm" : "wiki.shared_with_members")} {t("wiki.team_sync_hint")}</p> : <p className="text-xs leading-relaxed text-muted-foreground">{t(teamBinding ? "wiki.sharing_unavailable" : legacy ? "wiki.legacy_sharing" : "wiki.personal_hint")}</p>}
    <TeamNotice loading={team.isLoading} error={team.error} team={team.data} retry={() => void team.refetch()} />
    {editable ? <>
      {team.data ? <AudienceFields team={team.data} value={input} onChange={setInput} disabled={sharing || props.busy} /> : null}
      <Button type="button" size="sm" variant="outline" disabled={sharing || props.busy || !wikiSharingValid(input, team.data)} onClick={() => void run(() => props.onShare(input, Boolean(record)))}>{sharing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}{t(record ? "wiki.update_audience" : legacy ? "wiki.move_sharing" : "wiki.share_wiki")}</Button>
      {record ? <div className="space-y-2"><Button type="button" variant="ghost" size="sm" disabled={sharing || props.busy} className="text-destructive" onClick={() => { if (confirmStop) void run(props.onStop); else setConfirmStop(true); }}>{t(confirmStop ? "wiki.stop_sharing_confirm" : "wiki.stop_sharing")}</Button>{confirmStop ? <p className="text-xs leading-relaxed text-muted-foreground">{t("wiki.stop_sharing_hint")}</p> : null}</div> : null}
    </> : <><p className="text-xs text-muted-foreground">{t(record ? "wiki.owner_manages_sharing" : "wiki.sharing_unavailable")}</p>{record?.access === "members" && team.data ? <div className="text-xs text-muted-foreground">{record.memberIds.map((id) => team.data?.members.find((member) => member.userId === id)?.name || team.data?.members.find((member) => member.userId === id)?.email).filter(Boolean).join(", ")}</div> : null}</>}
  </section>;
}

export function WikiSettingsDialog(props: { client: LegalworkServerClient; serverUrl: string; wiki: WikiVault; projectWorkspaces: WikiWorkspaceOption[]; onClose: () => void; onUpdate: (input: WikiUpdateInput) => Promise<void>; onShare: (input: WikiSharingInput, update: boolean) => Promise<void>; onStopSharing: () => Promise<void>; onForget: () => Promise<void> }) {
  const [name, setName] = useState(props.wiki.name);
  const [allowInProjects, setAllowInProjects] = useState(props.wiki.allowInProjects);
  const [projectWorkspaceIds, setProjectWorkspaceIds] = useState<string[] | null>(props.wiki.projectWorkspaceIds ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(null); try { await operation(); } catch (err) { setError(wikiError(err)); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void run(() => props.onUpdate({ name: name.trim(), allowInProjects, projectWorkspaceIds })); }}><DialogHeader><DialogTitle>{t("wiki.settings")}</DialogTitle><DialogDescription>{props.wiki.root}</DialogDescription></DialogHeader>
    <label className="grid gap-1.5 text-sm">{t("wiki.name")}<Input required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
    <WikiSharingPanel client={props.client} serverUrl={props.serverUrl} wiki={props.wiki} busy={busy} onShare={props.onShare} onStop={props.onStopSharing} onError={setError} />
    <div className="space-y-3 border-t pt-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowInProjects} onChange={(event) => setAllowInProjects(event.target.checked)} className="mt-1" /><span>{t("wiki.project_access")}<span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t("wiki.project_access_hint")}</span></span></label>
    {allowInProjects ? <div className="space-y-3 rounded-lg border p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={projectWorkspaceIds === null} onChange={(event) => setProjectWorkspaceIds(event.target.checked ? null : [])} />{t("wiki.all_projects")}</label>{projectWorkspaceIds !== null ? <div className="max-h-40 space-y-2 overflow-y-auto">{props.projectWorkspaces.length ? props.projectWorkspaces.map((workspace) => <label key={workspace.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={projectWorkspaceIds.includes(workspace.id)} onChange={(event) => setProjectWorkspaceIds((current) => event.target.checked ? [...current ?? [], workspace.id] : (current ?? []).filter((id) => id !== workspace.id))} />{workspace.displayNameResolved}</label>) : <p className="text-xs text-muted-foreground">{t("wiki.no_projects")}</p>}</div> : null}</div> : null}</div>
    <p className="text-xs text-muted-foreground">{t("wiki.storage_size", { pages: props.wiki.pageCount, size: formatWikiSize(props.wiki.totalBytes) })}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="ghost" type="button" onClick={props.onClose}>{t("wiki.cancel")}</Button><Button disabled={busy || !name.trim()} type="submit">{busy ? <Loader2 size={16} className="animate-spin" /> : null}{t("wiki.save")}</Button></DialogFooter>
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
