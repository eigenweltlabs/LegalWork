import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const review = useQuery({
    queryKey: ["project-deletion", client?.baseUrl, workspaceId],
    enabled: !remote && !removal.deleted,
    queryFn: () => {
      if (!client) throw new Error(t("session_route.create_server_unavailable"));
      return client.reviewProjectDeletion(workspaceId);
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await removal.run(async () => {
        if (remote) return { sessionIds: [] };
        if (!client) throw new Error(t("session_route.create_server_unavailable"));
        if (!review.data) throw new Error(t("workspace.delete_checking"));
        return client.deleteProject(workspaceId, review.data.token);
      }, onConfirm);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("workspace.remove_failed"));
      if (!remote && !removal.deleted) await review.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent initialFocus={cancelRef} className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{t(removal.deleted ? "workspace.finish_removal_title" : remote ? "workspace.remove_title" : "workspace.delete_title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(remote ? "workspace.remove_description" : removal.deleted ? "workspace.finish_removal_description" : "workspace.delete_description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {!remote && !removal.deleted && review.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("workspace.delete_checking")}</p>}
        {!remote && !removal.deleted && review.data && <div className="space-y-3 text-sm">
          <p>{t("workspace.delete_chats", { count: review.data.chatCount })}</p>
          <div className="rounded-lg border p-3"><p className="font-medium">{t(!review.data.folderExists ? "workspace.folder_already_removed" : review.data.deleteFolder ? "workspace.delete_folder" : "workspace.keep_folder")}</p><p className="mt-1 break-all text-xs text-muted-foreground">{review.data.folder}</p></div>
          {review.data.copies.length > 0 && <div><p className="mb-2 flex items-center gap-2 font-medium"><Copy className="size-4" />{t("workspace.delete_keep_copies")}</p><ul className="max-h-40 space-y-1 overflow-auto text-muted-foreground">{review.data.copies.map((copy, index) => <li key={index} className="break-words">{copy.projectName} · {[copy.folder, copy.name].filter(Boolean).join("/")}</li>)}</ul></div>}
        </div>}
        {(error || review.error && !remote && !removal.deleted) && <p role="alert" className="text-sm text-destructive">{error || review.error?.message}</p>}
        {!remote && !removal.deleted && review.error && <Button variant="outline" disabled={busy || review.isFetching} onClick={() => void review.refetch()}>{t("common.retry")}</Button>}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>{t(removal.deleted ? "common.close" : "common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant={removal.deleted ? "default" : "destructive"} disabled={busy || !remote && !removal.deleted && (!review.data || review.isFetching || Boolean(review.error))} aria-busy={busy} onClick={() => void remove()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t(removal.deleted ? "common.retry" : remote ? "sidebar.remove_project" : "sidebar.delete_project")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
