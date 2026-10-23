import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowUpRight, CalendarDays, Copy, File, Folder, FolderOpen, Link2, ListTodo, Loader2, MessageSquare, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { t } from "@/i18n";
import { DashboardIcon } from "@/react-app/design-system/dashboard-icon";
import { openDesktopFolder } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { folderNameFromPath } from "@/react-app/shell/route-workspaces";
import { createProjectRemoval } from "./project-removal";

function folderParentLabel(path: string) {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const parents = parts.slice(-3, -1);
  return parents.length ? `… / ${parents.join(" / ")}` : "";
}

export function RemoveProjectDialog({ name, workspaceId, remote, client, onConfirm, onClose }: {
  name: string;
  workspaceId: string;
  remote: boolean;
  client: LegalworkServerClient | null;
  onConfirm: (sessionIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removal] = useState(createProjectRemoval);
  const [backupMode, setBackupMode] = useState(false);
  const [backupDirectory, setBackupDirectory] = useState("");
  const [manualBackupPath, setManualBackupPath] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const review = useQuery({
    queryKey: ["project-deletion", client?.baseUrl, workspaceId],
    enabled: !remote && !removal.deleted,
    queryFn: () => {
      if (!client) throw new Error(t("session_route.create_server_unavailable"));
      return client.reviewProjectDeletion(workspaceId);
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const deletesFiles = Boolean(review.data?.deleteFolder && review.data.folderExists);
  const wantsBackup = backupMode && deletesFiles;
  const deletionDescription = review.data
    ? t(!review.data.folderExists ? "workspace.delete_missing_folder_description" : review.data.deleteFolder ? "workspace.delete_managed_description" : "workspace.delete_source_description")
    : t("workspace.delete_description");
  const backupFolderName = backupDirectory.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const chooseBackup = async () => {
    if (!client || busy || picking) return;
    setBackupMode(true);
    setPicking(true);
    setError("");
    try {
      const selected = await client.pickWorkspaceFolder({ title: t("workspace.backup_choose") });
      if (!selected.supported) setManualBackupPath(true);
      else if (selected.path) setBackupDirectory(selected.path);
      else if (!backupDirectory) setBackupMode(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("workspace.remove_failed"));
    } finally { setPicking(false); }
  };
  const remove = async () => {
    if (busy || picking || !removal.deleted && wantsBackup && !backupDirectory.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await removal.run(async () => {
        if (remote) return { sessionIds: [] };
        if (!client) throw new Error(t("session_route.create_server_unavailable"));
        if (!review.data) throw new Error(t("workspace.delete_checking"));
        return client.deleteProject(workspaceId, review.data.token, wantsBackup ? backupDirectory.trim() : undefined);
      }, onConfirm);
      if (result.backupPath) toast.success(t("workspace.backup_saved"));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("workspace.remove_failed"));
      if (!remote && !removal.deleted) await review.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={open => { if (!open && !busy && !picking) onClose(); }}>
      <AlertDialogContent initialFocus={cancelRef} className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{t(removal.deleted ? "workspace.finish_removal_title" : remote ? "workspace.remove_title" : "workspace.delete_title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{remote ? t("workspace.remove_description") : removal.deleted ? t("workspace.finish_removal_description") : deletionDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {removal.backupPath && <p className="text-sm">{t("workspace.backup_saved")}</p>}
        {!remote && !removal.deleted && review.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("workspace.delete_checking")}</p>}
        {!remote && !removal.deleted && review.data && <div className="space-y-3 text-sm">
          {(review.data.chatCount > 0 || review.data.taskCount > 0 || review.data.calendarEntryCount > 0 || review.data.scheduledTaskCount > 0 || review.data.unsavedDashboardCount > 0) && <section className="rounded-lg border p-3">
            <p className="font-medium">{t("workspace.deletion_will_delete")}</p>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              {review.data.chatCount > 0 && <li className="flex items-center gap-2"><MessageSquare className="size-4 shrink-0" />{t("workspace.delete_chats", { count: review.data.chatCount })}</li>}
              {review.data.taskCount > 0 && <li className="flex items-center gap-2"><ListTodo className="size-4 shrink-0" />{t("workspace.delete_tasks", { count: review.data.taskCount })}</li>}
              {review.data.calendarEntryCount > 0 && <li className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0" />{t("workspace.delete_calendar_entries", { count: review.data.calendarEntryCount })}</li>}
              {review.data.scheduledTaskCount > 0 && <li className="flex items-center gap-2"><AlarmClock className="size-4 shrink-0" />{t("workspace.delete_scheduled_tasks", { count: review.data.scheduledTaskCount })}</li>}
              {review.data.unsavedDashboardCount > 0 && <li className="flex items-center gap-2"><DashboardIcon className="size-4 shrink-0" />{t("workspace.delete_unsaved_dashboards", { count: review.data.unsavedDashboardCount })}</li>}
            </ul>
          </section>}
          {!review.data.folderExists && <p className="text-muted-foreground">{t("workspace.folder_already_removed")}</p>}
          {deletesFiles && <section className="rounded-lg border p-3">
            <p className="font-medium">{t("workspace.delete_folder")}</p>
            {review.data.folderItems && <>
              <p className="mt-1 text-xs text-muted-foreground">{t("workspace.folder_items", { count: review.data.folderItems.total })}</p>
              {review.data.folderItems.items.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-muted-foreground">{(showAllFiles ? review.data.folderItems.items : review.data.folderItems.items.slice(0, 6)).map(item => <li key={item.name} className="flex items-center gap-2 break-words"><span className="shrink-0">{item.kind === "folder" ? <Folder className="size-4" /> : item.kind === "link" ? <Link2 className="size-4" /> : <File className="size-4" />}</span>{item.name}</li>)}</ul>}
              {review.data.folderItems.total > 6 && <Button variant="ghost" size="sm" className="mt-2" aria-expanded={showAllFiles} onClick={() => setShowAllFiles(value => !value)}>{t(showAllFiles ? "workspace.folder_items_show_less" : "workspace.folder_items_show_all", { count: review.data.folderItems.total })}</Button>}
            </>}
            {!backupMode && <div className="mt-3 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><div><p className="font-medium text-destructive">{t("workspace.backup_warning_title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("workspace.backup_warning_description")}</p></div></div>
              <Button variant="outline" size="sm" disabled={busy || picking} onClick={() => void chooseBackup()}><FolderOpen className="size-4" />{t("workspace.backup_choose")}</Button>
            </div>}
            {backupMode && manualBackupPath && <div className="mt-3 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"><label htmlFor="project-backup-directory" className="font-medium">{t("workspace.backup_choose")}</label><Input id="project-backup-directory" value={backupDirectory} disabled={busy || picking} onChange={event => setBackupDirectory(event.target.value)} placeholder={t("workspace.backup_path_placeholder")} /></div>}
            {backupMode && !manualBackupPath && backupFolderName && <div className="mt-3 flex items-start gap-3 rounded-lg border border-blue-6/30 bg-blue-3/20 p-3"><Folder className="mt-0.5 size-4 shrink-0 text-blue-11" /><div className="min-w-0 flex-1"><p className="font-medium text-blue-11">{t("workspace.save_location_title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("workspace.save_location_description")}</p><div className="mt-2 flex items-center gap-2"><button type="button" disabled={!isDesktopRuntime() || busy || picking} title={`${t("workspace.backup_selected", { name: backupDirectory })} — ${t("sidebar.reveal_project")}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-blue-3/40 px-2 py-2 text-left text-blue-11 transition-colors hover:bg-blue-4/50 disabled:cursor-default disabled:hover:bg-blue-3/40" onClick={() => { void openDesktopFolder(backupDirectory).catch(() => toast.error(t("workspace_files.open_failed_title"))); }}><FolderOpen className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{backupFolderName}</span>{folderParentLabel(backupDirectory) && <span className="block truncate text-xs text-muted-foreground">{folderParentLabel(backupDirectory)}</span>}</span>{isDesktopRuntime() && <ArrowUpRight className="size-4 shrink-0" />}</button><Button variant="ghost" size="sm" disabled={busy || picking} onClick={() => void chooseBackup()}>{t("common.edit")}</Button></div></div></div>}
          </section>}
          {review.data.folderExists && !review.data.deleteFolder && <div className="flex items-start gap-3 rounded-lg border border-blue-6/30 bg-blue-3/20 p-3"><Folder className="mt-0.5 size-4 shrink-0 text-blue-11" /><div className="min-w-0 flex-1"><p className="font-medium text-blue-11">{t("workspace.keep_folder")}</p><p className="mt-1 text-xs text-muted-foreground">{t("workspace.keep_folder_description")}</p><button type="button" disabled={!isDesktopRuntime()} title={review.data.folder} className="mt-2 flex w-full items-center gap-2 rounded-md bg-blue-3/40 px-2 py-2 text-left text-blue-11 transition-colors hover:bg-blue-4/50 disabled:cursor-default disabled:hover:bg-blue-3/40" onClick={() => { void openDesktopFolder(review.data!.folder).catch(() => toast.error(t("workspace_files.open_failed_title"))); }}><FolderOpen className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{folderNameFromPath(review.data.folder)}</span>{folderParentLabel(review.data.folder) && <span className="block truncate text-xs text-muted-foreground">{folderParentLabel(review.data.folder)}</span>}</span>{isDesktopRuntime() && <ArrowUpRight className="size-4 shrink-0" />}</button></div></div>}
          {review.data.copies.length > 0 && <section className="rounded-lg border p-3"><p className="flex items-center gap-2 font-medium"><Copy className="size-4" />{t("workspace.delete_keep_copies")}</p><p className="mt-1 text-xs text-muted-foreground">{t("workspace.delete_keep_copies_description")}</p><ul className="mt-2 max-h-40 space-y-1 overflow-auto text-muted-foreground">{review.data.copies.map((copy, index) => <li key={index} className="break-words">{copy.name} <span className="text-xs">→ {copy.projectName}</span></li>)}</ul></section>}
        </div>}
        {(error || review.error && !remote && !removal.deleted) && <p role="alert" className="text-sm text-destructive">{error || review.error?.message}</p>}
        {!remote && !removal.deleted && review.error && <Button variant="outline" disabled={busy || review.isFetching} onClick={() => void review.refetch()}>{t("common.retry")}</Button>}
        {busy && backupMode && !removal.deleted && <p role="status" className="text-sm text-muted-foreground">{t("workspace.backup_working")}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy || picking}>{t(removal.deleted ? "common.close" : "common.cancel")}</AlertDialogCancel>
          {!remote && !removal.deleted && wantsBackup && <Button disabled={busy || picking || !backupDirectory.trim()} aria-busy={busy} onClick={() => void remove()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("workspace.backup_and_delete")}
          </Button>}
          {!wantsBackup && <Button variant={removal.deleted ? "default" : "destructive"} disabled={busy || picking || !remote && !removal.deleted && (!review.data || review.isFetching || Boolean(review.error))} aria-busy={busy} onClick={() => void remove()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t(removal.deleted ? "common.retry" : remote ? "sidebar.remove_project" : deletesFiles ? "workspace.delete_with_files" : "workspace.delete_with_chats")}
          </Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
