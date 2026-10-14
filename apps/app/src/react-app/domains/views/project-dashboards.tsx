import { LayoutDashboard, Loader2 } from "lucide-react";
import type { ViewSummary } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useSavedViews } from "./view-list";

export function ProjectDashboards({ client, workspaceId, onOpen }: { client: LegalworkServerClient; workspaceId: string; onOpen: (view: ViewSummary) => void }) {
  const views = useSavedViews(client, { kind: "workspace", id: workspaceId });
  return <div className="lw-project-page-content lw-project-page-top h-full overflow-y-auto">
    <h1 className="flex items-center gap-3 text-2xl font-semibold"><LayoutDashboard className="size-6" />{t("views.dashboards")}</h1>
    <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("views.project_hint")}</p>
    {views.isPending && <Loader2 className="size-5 animate-spin" />}
    {views.error && <p role="alert" className="text-sm text-destructive">{views.error.message}<Button size="sm" variant="ghost" onClick={() => void views.refetch()}>{t("wiki.retry")}</Button></p>}
    {views.data && !views.data.items.length && <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">{t("views.no_saved_dashboards")}</div>}
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">{views.data?.items.map(view => <button key={view.id} className="flex items-start gap-3 rounded-xl border p-4 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(view)}><LayoutDashboard className="mt-1 size-5 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{view.title}</span><span className="mt-1 block text-xs text-muted-foreground">{view.mode === "report" ? t("views.report") : t("views.dashboards")} · {new Date(view.updatedAt).toLocaleString()}</span></span></button>)}</div>
    {views.data?.issues.map(issue => <p key={issue.path} role="alert" className="mt-3 text-sm text-destructive">{issue.path}: {issue.message}</p>)}
  </div>;
}
