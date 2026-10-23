import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, File, Folder, FolderOpen, Link2, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { t } from "@/i18n";
import { createProjectRemoval } from "./project-removal";

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
  const review = useQuery({
    queryKey: ["project-deletion", client?.baseUrl, workspaceId],
    enabled: !remote && !removal.deleted,
    queryFn: () => {
      if (!client) throw new Error(t("session_route.create_server_unavailable"));
      return client.reviewProjectDeletion(workspaceId);
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const wantsBackup = backupMode && Boolean(review.data?.deleteFolder);
  const deletionDescription = review.data
    ? t(review.data.deleteFolder ? "workspace.delete_managed_description" : "workspace.delete_source_description")
    : t("workspace.delete_description");
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
          <section className="rounded-lg border p-3">
            <p className="font-medium">{t("workspace.deletion_will_delete")}</p>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              <li className="flex items-center gap-2"><MessageSquare className="size-4 shrink-0" />{t("workspace.delete_chats", { count: review.data.chatCount })}</li>
              <li className="flex items-center gap-2"><File className="size-4 shrink-0" />{t("workspace.delete_project_records")}</li>
              <li className="flex items-center gap-2"><File className="size-4 shrink-0" />{t("workspace.delete_unsaved_dashboards")}</li>
            </ul>
          </section>
          <section className="rounded-lg border p-3">
            <p className="font-medium">{t(!review.data.folderExists ? "workspace.folder_already_removed" : review.data.deleteFolder ? "workspace.delete_folder" : "workspace.keep_folder")}</p>
            {review.data.folderItems && <>
              <p className="mt-1 text-xs text-muted-foreground">{t("workspace.folder_items", { count: review.data.folderItems.total })}</p>
              {review.data.folderItems.items.length > 0 && <ul className="mt-2 space-y-1 text-muted-foreground">{review.data.folderItems.items.map(item => <li key={item.name} className="flex items-center gap-2 break-words"><span className="shrink-0">{item.kind === "folder" ? <Folder className="size-4" /> : item.kind === "link" ? <Link2 className="size-4" /> : <File className="size-4" />}</span>{item.name}</li>)}{review.data.folderItems.total > review.data.folderItems.items.length && <li className="pl-6 text-xs">{t("workspace.folder_items_more", { count: review.data.folderItems.total - review.data.folderItems.items.length })}</li>}</ul>}
            </>}
          </section>
          {review.data.deleteFolder && <p className="text-muted-foreground">{t("workspace.delete_folder_warning")}</p>}
          {review.data.deleteFolder && backupMode && <div className="space-y-2 rounded-lg border p-3">
            <label htmlFor="project-backup-directory" className="font-medium">{t("workspace.backup_choose")}</label>
            <Input id="project-backup-directory" value={backupDirectory} readOnly={!manualBackupPath} disabled={busy || picking} onChange={event => setBackupDirectory(event.target.value)} placeholder={t("workspace.backup_path_placeholder")} />
            <p className="text-xs text-muted-foreground">{t("workspace.backup_hint")}</p>
            {!manualBackupPath && <Button variant="outline" size="sm" disabled={busy || picking} onClick={() => void chooseBackup()}><FolderOpen className="size-4" />{t("workspace.backup_choose")}</Button>}
          </div>}
          {review.data.copies.length > 0 && <section className="rounded-lg border p-3"><p className="flex items-center gap-2 font-medium"><Copy className="size-4" />{t("workspace.delete_keep_copies")}</p><p className="mt-1 text-xs text-muted-foreground">{t("workspace.delete_keep_copies_description")}</p><ul className="mt-2 max-h-40 space-y-1 overflow-auto text-muted-foreground">{review.data.copies.map((copy, index) => <li key={index} className="break-words">{copy.name} <span className="text-xs">→ {copy.projectName}</span></li>)}</ul></section>}
        </div>}
        {(error || review.error && !remote && !removal.deleted) && <p role="alert" className="text-sm text-destructive">{error || review.error?.message}</p>}
        {!remote && !removal.deleted && review.error && <Button variant="outline" disabled={busy || review.isFetching} onClick={() => void review.refetch()}>{t("common.retry")}</Button>}
        {busy && backupMode && !removal.deleted && <p role="status" className="text-sm text-muted-foreground">{t("workspace.backup_working")}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy || picking}>{t(removal.deleted ? "common.close" : "common.cancel")}</AlertDialogCancel>
          {!remote && !removal.deleted && review.data?.deleteFolder && !backupMode && <Button variant="outline" disabled={busy || picking || review.isFetching || Boolean(review.error)} onClick={() => void chooseBackup()}>{t("workspace.backup_and_delete")}</Button>}
          <AlertDialogAction variant={removal.deleted || wantsBackup ? "default" : "destructive"} disabled={busy || picking || !remote && !removal.deleted && (!review.data || review.isFetching || Boolean(review.error) || wantsBackup && !backupDirectory.trim())} aria-busy={busy} onClick={() => void remove()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t(removal.deleted ? "common.retry" : remote ? "sidebar.remove_project" : wantsBackup ? "workspace.backup_and_delete" : review.data?.deleteFolder ? "workspace.delete_with_files" : "workspace.delete_with_chats")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
