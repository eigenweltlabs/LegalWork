import { WikiContentPreview } from "./wiki-content-preview";
import { WikiDiff, WikiContentStats } from "./wiki-diff";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WikiRevision } from "@legalwork/types/wiki";
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RotateCcw } from "lucide-react";
import { t } from "@/i18n";

export function WikiRevisionDialog({ client, wikiId, revision, writable, onClose, onRestore }: {
  client: LegalworkServerClient; wikiId: string; revision: WikiRevision; writable: boolean;
  onClose: () => void; onRestore: (path: string, revisionId: string, baseRevision: string) => Promise<void>;
}) {
  const [compare, setCompare] = useState(false);
  const [target, setTarget] = useState("current");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useQuery({ queryKey: ["wiki-version", client.baseUrl, wikiId, revision.path, revision.id], queryFn: () => client.wikiRevision(wikiId, revision.path, revision.id) });
  const versions = useQuery({ queryKey: ["wiki-history", client.baseUrl, wikiId, revision.path], queryFn: () => client.wikiHistory(wikiId, revision.path) });
  const current = useQuery({ queryKey: ["wiki-version-current", client.baseUrl, wikiId, revision.path, revision.id], staleTime: Infinity, gcTime: 0,
    queryFn: async () => {
      try { return await client.readWikiPage(wikiId, revision.path); }
      catch (error) { if (error instanceof LegalworkServerError && error.status === 404) return { content: "", revision: "", deleted: true }; throw error; }
    },
  });
  const historical = useQuery({ queryKey: ["wiki-version", client.baseUrl, wikiId, revision.path, target], enabled: compare && target !== "current",
    queryFn: () => client.wikiRevision(wikiId, revision.path, target),
  });
  const comparison = target === "current" ? current : historical;
  const failure = error || version.error?.message || current.error?.message || (compare ? comparison.error?.message : "");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
    <DialogHeader><DialogTitle>{revision.path}</DialogTitle><DialogDescription>{t("wiki.version_from", { date: new Date(revision.createdAt).toLocaleString() })}</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={!compare ? "secondary" : "ghost"} onClick={() => setCompare(false)}>{t("wiki.version_content")}</Button>
      <Button size="sm" variant={compare ? "secondary" : "ghost"} onClick={() => setCompare(true)}>{t("wiki.compare_versions")}</Button>
      {version.data && comparison.data && <WikiContentStats before={version.data.content} after={comparison.data.content} />}
      {compare && <label className="flex min-w-0 items-center gap-2 text-sm">{t("wiki.compare_with")}<select className="h-9 min-w-0 rounded-md border bg-background px-2" value={target} onChange={event => setTarget(event.target.value)}>
        <option value="current">{t("wiki.current_version")}</option>
        {versions.data?.items.filter(item => item.id !== revision.id).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.action === "delete" ? t("wiki.revision_delete") : item.action === "restore" ? t("wiki.revision_restore") : t("wiki.revision_write")}</option>)}
      </select></label>}
    </div>
    {compare && <p className="text-xs text-muted-foreground">{t("wiki.diff_direction")}{comparison.data && "deleted" in comparison.data ? ` · ${t("wiki.current_deleted")}` : ""}</p>}
    {failure && <p role="alert" className="text-sm text-destructive">{failure}<Button size="sm" variant="ghost" onClick={() => { setError(""); void version.refetch(); void current.refetch(); if (compare && target !== "current") void historical.refetch(); }}>{t("wiki.retry")}</Button></p>}
    <div className="min-h-0 overflow-auto rounded-lg border">
      {!version.data || (compare && !comparison.data) ? failure ? null : <div className="p-8"><Loader2 className="mx-auto size-5 animate-spin" aria-label={t("wiki.loading")} /></div> : compare && comparison.data ? <WikiDiff before={version.data.content} after={comparison.data.content} /> : <WikiContentPreview client={client} wikiId={wikiId} path={revision.path} content={version.data.content} />}
    </div>
    <DialogFooter>
      <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.close")}</Button>
      {writable && revision.action !== "delete" && <Button disabled={busy || !version.data || !current.data || current.isFetching} onClick={() => {
        if (!current.data) return;
        setBusy(true); setError("");
        void onRestore(revision.path, revision.id, current.data.revision).then(onClose).catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
      }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{t("wiki.restore_this_version")}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
