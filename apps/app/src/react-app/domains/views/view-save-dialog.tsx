import { DashboardIcon } from "@/react-app/design-system/dashboard-icon";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Loader2 } from "lucide-react";
import type { ViewSaveSource, ViewOwner, ViewPreview, ViewRecord } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { sameViewOwner, viewInputForDestination, viewOwnerKey } from "./view-save";

export function ViewSaveDialog({ client, preview, savedFrom, fromChat = false, onClose, onSaved }: { savedFrom?: ViewSaveSource; fromChat?: boolean; client: LegalworkServerClient; preview: ViewPreview; onClose: () => void; onSaved: (view: ViewRecord) => void }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string[]>([viewOwnerKey(preview.owner)]);
  const [saved, setSaved] = useState<ViewRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const destinations = useQuery({ queryKey: ["view-save-destinations", client.baseUrl], queryFn: async () => {
    const [projects, wikis] = await Promise.all([client.listWorkspaces(), client.listWikis()]);
    const entries: { owner: ViewOwner; name: string }[] = projects.items.filter(project => project.workspaceType !== "remote" && !wikis.items.some(wiki => wiki.workspaceId === project.id)).map(project => ({ owner: { kind: "workspace", id: project.id }, name: project.displayName || project.name }));
    entries.push(...wikis.items.filter(wiki => wiki.writable).map(wiki => ({ owner: { kind: "wiki", id: wiki.id } satisfies ViewOwner, name: wiki.name })));
    return entries;
  } });
  const targets = destinations.data?.filter(item => selected.includes(viewOwnerKey(item.owner))) ?? [];
  const finish = () => { if (saved[0]) onSaved(saved[0]); else onClose(); };
  const save = async () => {
    setBusy(true); setError("");
    const completed = [...saved];
    try {
      for (const { owner } of targets) {
        if (completed.some(view => sameViewOwner(view.owner, owner))) continue;
        const input = { ...viewInputForDestination(preview.input, preview.owner, owner), savedFrom };
        const result = preview.target && sameViewOwner(preview.owner, owner)
          ? await client.updateView(owner, preview.target.viewId, { baseRevision: preview.target.baseRevision, input })
          : await client.createView(owner, input);
        completed.push(result); setSaved([...completed]);
        void cache.invalidateQueries({ queryKey: ["ui-views", client.baseUrl, owner.kind, owner.id] });
        void cache.invalidateQueries({ queryKey: ["ui-view", client.baseUrl, owner.kind, owner.id] });
        if (owner.kind === "wiki") void cache.invalidateQueries({ queryKey: ["wiki-snapshot", client.baseUrl, owner.id] });
      }
      if (completed[0]) onSaved(completed[0]);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) finish(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t("views.save_title")}</DialogTitle><DialogDescription>{t(fromChat ? "views.preview_save_hint" : "views.save_hint")}</DialogDescription></DialogHeader>
    <div className="max-h-[45vh] space-y-2 overflow-y-auto">
      {destinations.isPending && <Loader2 className="size-5 animate-spin" />}
      {destinations.error && <p role="alert" className="text-sm text-destructive">{destinations.error.message}<Button size="sm" variant="ghost" onClick={() => void destinations.refetch()}>{t("wiki.retry")}</Button></p>}
      {destinations.data?.map(({ owner, name }) => { const key = viewOwnerKey(owner), done = saved.some(view => sameViewOwner(view.owner, owner)); return <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-accent">
        <input type="checkbox" checked={done || selected.includes(key)} disabled={busy || done} onChange={event => setSelected(values => event.target.checked ? [...values, key] : values.filter(value => value !== key))} />
        {owner.kind === "wiki" ? <BookOpen className="size-4 shrink-0" /> : <DashboardIcon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{name}</span><span className="text-xs text-muted-foreground">{t(owner.kind === "wiki" ? "wiki.title" : "views.project_dashboards")}{preview.target && sameViewOwner(owner, preview.owner) ? ` · ${t("views.update_saved")}` : ""}</span></span>{done && <Check className="size-4 text-success" />}
      </label>; })}
    </div>
    {targets.some(item => !sameViewOwner(item.owner, preview.owner)) && Object.keys(preview.input.queries).length > 0 && <p className="text-xs text-muted-foreground">{t("views.copy_snapshot_hint")}</p>}
    {targets.some(item => item.owner.kind === "wiki") && <p className="text-xs text-muted-foreground">{t("views.wiki_save_hint")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="ghost" disabled={busy} onClick={finish}>{t("common.cancel")}</Button><Button disabled={busy || !targets.length || destinations.isFetching} onClick={() => void save()}>{busy && <Loader2 className="size-4 animate-spin" />}{t("common.save")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
