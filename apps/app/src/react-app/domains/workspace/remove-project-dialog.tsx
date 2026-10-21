import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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

export function RemoveProjectDialog({ name, onConfirm, onClose }: {
  name: string;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onConfirm()) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{t("workspace.remove_title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("workspace.remove_description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void remove()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("sidebar.remove_project")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
