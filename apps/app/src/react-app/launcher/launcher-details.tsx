import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LauncherFileFilter, LauncherSearchKind, LauncherSearchResult } from "@legalwork/types/launcher";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLauncherShell } from "./launcher-shell";

export type LauncherDetail = { result: LauncherSearchResult; category?: LauncherSearchKind };
export function useLauncherDetailItems(detail: LauncherDetail | null, query: string, filter: LauncherFileFilter) {
  const { client } = useLauncherShell();
  const result = detail?.result;
  const directory = result?.fileType === "folder" || result?.kind === "projects" && detail?.category === "files";
  const category = result?.kind === "projects" ? detail?.category : undefined;
  return useQuery<{ items: LauncherSearchResult[]; truncated: boolean }>({
    queryKey: ["launcher-detail-items", client.baseUrl, result?.workspaceId, result?.folderId, result?.path, category, directory ? null : query, directory ? null : filter],
    enabled: Boolean(result && (directory || category)),
    select: response => directory ? { ...response, items: response.items.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (item.fileType === "folder" || (!filter.types?.length || filter.types.includes(item.fileType ?? "")) && (!filter.modifiedAfter || item.updatedAt >= filter.modifiedAfter))) } : response,
    queryFn: async ({ signal }) => {
      if (!result) return { items: [], truncated: false };
      if (directory) {
        return client.launcherBrowse({ workspaceId: result.workspaceId ?? undefined, folderId: result.folderId, path: result.path ?? "" }, signal);
      }
      const response = await client.launcherSearch({ query, kinds: category ? [category] : [], projectId: result.workspaceId, fileTypes: filter.types, modifiedAfter: filter.modifiedAfter }, signal);
      return { items: response.items, truncated: response.sources.some(source => source.limited) };
    },
  });
}

export function LauncherTaskDetail({ result, onOpenChat }: { result: LauncherSearchResult; onOpenChat: (sessionId: string, workspaceId: string) => void }) {
  const { client, assistant, workspaces } = useLauncherShell();
  const workspaceId = result.workspaceId ?? assistant?.workspaceId ?? workspaces[0]?.id;
  const task = useQuery({ queryKey: ["launcher-task", client.baseUrl, workspaceId, result.id], enabled: Boolean(workspaceId), queryFn: () => client.getTask(workspaceId ?? "", result.id) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeStatus = async () => {
    if (!task.data || !workspaceId || busy) return;
    setBusy(true); setError(null);
    try { await client.patchTask(workspaceId, result.id, { status: task.data.task.status === "done" ? "open" : "done" }); await task.refetch(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const item = task.data?.task;
  return <section className="launcher-detail-content">
    <strong>{item?.title ?? result.title}</strong>
    {task.isPending ? <p>{t("launcher.preview.loading")}</p> : task.isError ? <p role="alert">{String(task.error)}</p> : <>
      <p className="text-muted-foreground">{[item && t(`tasks.status_${item.status}`), item?.dueDate, item?.assigneeName].filter(Boolean).join(" · ")}</p>
      <p className="whitespace-pre-wrap">{item?.description}</p>
      {task.data?.notes.map(note => <p key={note.id} className="whitespace-pre-wrap">{note.body}</p>)}
      <div className="launcher-detail-controls"><Button variant="outline" size="sm" disabled={busy} onClick={() => void changeStatus()}>{t(item?.status === "done" ? "launcher.detail.reopen_task" : "launcher.result_action.complete")}</Button></div>
      {item?.sessions.map(link => <Button key={link.sessionId} variant="ghost" size="sm" onClick={() => onOpenChat(link.sessionId, link.workspaceId)}>{t("launcher.detail.open_chat")}</Button>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
