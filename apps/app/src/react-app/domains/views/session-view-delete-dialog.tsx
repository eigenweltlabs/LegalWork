import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check } from "lucide-react";
import type { SessionViewPreview, SessionViewReview, ViewOwner, ViewRecord } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardIcon } from "@/react-app/design-system/dashboard-icon";
import { t } from "@/i18n";
import { sameViewOwner, viewInputForDestination, viewOwnerKey } from "./view-save";
import { useViewGenerationStore, viewGenerationId } from "./view-generation";

export type SessionViewDeleteRequest = { client: LegalworkServerClient; workspaceId: string; sessionId: string; review: SessionViewReview; onDelete: (discardReview?: string) => Promise<void> };
export function SessionViewDeleteDialog({ request, onClose }: { request: SessionViewDeleteRequest; onClose: () => void }) {
  const { client, workspaceId, sessionId } = request;
  const [review, setReview] = useState(request.review);
  const cache = useQueryClient();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, ViewRecord>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const destinations = useQuery({ queryKey: ["view-save-destinations", client.baseUrl], queryFn: async () => {
    const [projects, wikis] = await Promise.all([client.listWorkspaces(), client.listWikis()]);
    return [
      ...projects.items.filter(project => project.workspaceType !== "remote" && !wikis.items.some(wiki => wiki.workspaceId === project.id)).map(project => ({ owner: { kind: "workspace", id: project.id } satisfies ViewOwner, name: project.displayName || project.name })),
      ...wikis.items.filter(wiki => wiki.writable).map(wiki => ({ owner: { kind: "wiki", id: wiki.id } satisfies ViewOwner, name: wiki.name })),
    ];
  } });
  const itemKey = (item: SessionViewPreview) => JSON.stringify([item.sessionId ?? sessionId, item.callId]);
  const destination = (item: SessionViewPreview, owner: ViewOwner) => destinations.data?.find(target => viewOwnerKey(target.owner) === (targets[itemKey(item)] ?? viewOwnerKey(owner)));
  const run = async (save: boolean) => {
    setBusy(true); setError("");
    try {
      if (save) for (const item of review.items) {
        if (saved[itemKey(item)]) continue;
        if (!item.preview) throw new Error(t("views.delete_preview_unavailable"));
        const preview = item.preview, target = destination(item, preview.owner);
        if (!target) throw new Error(t("views.delete_choose_destination"));
        const input = { ...viewInputForDestination(preview.input, preview.owner, target.owner), savedFrom: { workspaceId, sessionId: item.sessionId ?? sessionId, callId: item.callId } };
        const view = preview.target && sameViewOwner(preview.owner, target.owner)
          ? await client.updateView(target.owner, preview.target.viewId, { input, baseRevision: preview.target.baseRevision })
          : await client.createView(target.owner, input);
        setSaved(values => ({ ...values, [itemKey(item)]: view }));
        void cache.invalidateQueries({ queryKey: ["ui-views", client.baseUrl, view.owner.kind, view.owner.id] });
        if (view.owner.kind === "wiki") void cache.invalidateQueries({ queryKey: ["wiki-snapshot", client.baseUrl, view.owner.id] });
        useViewGenerationStore.getState().markSaved(viewGenerationId(client.baseUrl, item.sessionId ?? sessionId, item.callId), view);
      }
      await request.onDelete(save ? undefined : review.reviewToken);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      try {
        const current = await client.sessionViewReview(workspaceId, sessionId);
        setReview(current);
        setSaved(values => Object.fromEntries(Object.entries(values).filter(([key]) => !current.items.some(item => itemKey(item) === key))));
      } catch { /* Keep the dialog and chat intact if refreshing fails. */ }
    }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>{t("views.delete_chat_title")}</DialogTitle><DialogDescription>{t("views.delete_chat_description")}</DialogDescription></DialogHeader>
    <div className="max-h-[45vh] space-y-3 overflow-auto">
      {review.items.map(item => <div key={itemKey(item)} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2"><DashboardIcon className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>{saved[itemKey(item)] && <Check className="size-4 text-success" aria-label={t("views.delete_saved")} />}</div>
        {item.preview ? <label className="flex items-center gap-2 text-xs text-muted-foreground">{t("views.delete_save_in")}<select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm text-foreground" disabled={busy || Boolean(saved[itemKey(item)])} value={targets[itemKey(item)] ?? viewOwnerKey(item.preview.owner)} onChange={event => setTargets(values => ({ ...values, [itemKey(item)]: event.target.value }))}>
          {!destination(item, item.preview.owner) && <option value={targets[itemKey(item)] ?? viewOwnerKey(item.preview.owner)}>{t("views.delete_choose_destination")}</option>}
          {destinations.data?.map(target => <option key={viewOwnerKey(target.owner)} value={viewOwnerKey(target.owner)}>{target.name} · {t(target.owner.kind === "wiki" ? "wiki.title" : "views.project_dashboards")}</option>)}
        </select></label> : <p className="text-xs text-muted-foreground">{t("views.delete_preview_unavailable")}</p>}
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">{t("views.copy_snapshot_hint")}</p>
    {(error || destinations.error) && <p role="alert" className="text-sm text-destructive">{error || destinations.error?.message}</p>}
    <DialogFooter className="flex-wrap"><Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button variant="outline" disabled={busy} onClick={() => void run(false)}>{t("views.delete_without_saving")}</Button><Button disabled={busy || destinations.isPending || review.items.some(item => !item.preview || !saved[itemKey(item)] && !destination(item, item.preview.owner))} onClick={() => void run(true)}>{busy && <Loader2 className="size-4 animate-spin" />}{t("views.save_and_delete")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
