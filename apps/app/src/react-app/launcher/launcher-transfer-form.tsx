import { useRef, useState } from "react";
import type { LauncherSearchResult } from "@legalwork/types/launcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { useLauncherShell } from "./launcher-shell";

export type LauncherTransfer = { items: LauncherSearchResult[]; workspaceId: string; folder: string; mode: "copy" | "move" };
export function LauncherTransferForm({ transfer, onClose }: { transfer: LauncherTransfer; onClose: () => void }) {
  const { client, workspaces } = useLauncherShell();
  const [folder, setFolder] = useState(transfer.folder);
  const [remaining, setRemaining] = useState(transfer.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const project = workspaces.find(item => item.id === transfer.workspaceId);
  const submit = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      for (const item of remaining) {
        await client.transferLauncherFile({ sourceWorkspaceId: item.workspaceId ?? "", targetWorkspaceId: transfer.workspaceId, path: item.path ?? "", folder, mode: transfer.mode });
        setRemaining(items => items.filter(other => other !== item));
      }
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; setBusy(false); }
  };
  return <form className="launcher-create-form" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}>
    <strong>{t(transfer.mode === "copy" ? "launcher.result_action.copy-to-project" : "launcher.result_action.move-to-project")}</strong>
    <p>{project?.displayName || project?.name} · {remaining.length} {t("launcher.kind.files")}</p>
    <label>{t("launcher.flow.folder")}<Input value={folder} autoFocus disabled={busy} onChange={event => setFolder(event.target.value)} /></label>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    <div className="launcher-form-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button disabled={busy} type="submit">{busy ? t("launcher.flow.saving") : t(transfer.mode === "copy" ? "launcher.result_action.copy-to-project" : "launcher.result_action.move-to-project")}</Button></div>
  </form>;
}
