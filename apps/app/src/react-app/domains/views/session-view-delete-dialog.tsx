import { useViewSaveDestinations, viewSaveDestinationGroups } from "./view-save-destinations";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  const destinations = useViewSaveDestinations(client);
  const groups = viewSaveDestinationGroups(destinations.data);
  const itemKey = (item: SessionViewPreview) => JSON.stringify([item.sessionId ?? sessionId, item.callId]);
  const destination = (item: SessionViewPreview, owner: ViewOwner) => destinations.data?.find(target => viewOwnerKey(target.owner) === (targets[itemKey(item)] ?? viewOwnerKey(owner)));
  const selectedTargets = review.items.flatMap(item => {
    if (!item.preview || saved[itemKey(item)]) return [];
    const target = destination(item, item.preview.owner);
    return target ? [{ owner: target.owner, preview: item.preview }] : [];
  });
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
    {destinations.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("common.loading")}</p>}
    {destinations.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("views.no_save_destinations")}</p>}
    <div className="max-h-[45vh] space-y-3 overflow-auto">
      {review.items.map(item => <div key={itemKey(item)} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2"><DashboardIcon className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>{saved[itemKey(item)] && <Check className="size-4 text-success" aria-label={t("views.delete_saved")} />}</div>
        {item.preview ? <label className="flex items-center gap-2 text-xs text-muted-foreground">{t("views.delete_save_in")}<select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm text-foreground" disabled={busy || destinations.isPending || Boolean(destinations.error) || Boolean(saved[itemKey(item)])} value={targets[itemKey(item)] ?? viewOwnerKey(item.preview.owner)} onChange={event => setTargets(values => ({ ...values, [itemKey(item)]: event.target.value }))}>
          {!destination(item, item.preview.owner) && <option value={targets[itemKey(item)] ?? viewOwnerKey(item.preview.owner)}>{t("views.delete_choose_destination")}</option>}
          {groups.map(group => <optgroup key={group.kind} label={group.label}>{group.items.map(target => <option key={viewOwnerKey(target.owner)} value={viewOwnerKey(target.owner)}>{target.name}</option>)}</optgroup>)}
        </select></label> : <p className="text-xs text-muted-foreground">{t("views.delete_preview_unavailable")}</p>}
      </div>)}
    </div>
    {selectedTargets.some(({ owner, preview }) => !sameViewOwner(owner, preview.owner) && Object.keys(preview.input.queries).length > 0) && <p className="text-xs text-muted-foreground">{t("views.copy_snapshot_hint")}</p>}
    {selectedTargets.some(({ owner }) => owner.kind === "wiki") && <p className="text-xs text-muted-foreground">{t("views.wiki_save_hint")}</p>}
    {(error || destinations.error) && <p role="alert" className="text-sm text-destructive">{error || destinations.error?.message}</p>}
    {destinations.error && <Button variant="ghost" size="sm" disabled={busy || destinations.isFetching} onClick={() => void destinations.refetch()}>{t("wiki.retry")}</Button>}
    <DialogFooter className="flex-wrap"><Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button variant="outline" disabled={busy} onClick={() => void run(false)}>{t("views.delete_without_saving")}</Button><Button disabled={busy || destinations.isFetching || Boolean(destinations.error) || review.items.some(item => !item.preview || !saved[itemKey(item)] && !destination(item, item.preview.owner))} onClick={() => void run(true)}>{busy && <Loader2 className="size-4 animate-spin" />}{t("views.save_and_delete")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
