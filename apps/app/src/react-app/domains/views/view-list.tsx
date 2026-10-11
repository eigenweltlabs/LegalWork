import { useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { ViewOwner } from "@legalwork/types/views";
import { ChartNoAxesCombined, FileChartColumn } from "lucide-react";
import { FileBrowserRow } from "@/react-app/design-system/file-browser-row";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { viewPanelTab } from "./view-reference";

export function ViewList({ client, owner }: { client: LegalworkServerClient | null; owner: ViewOwner }) {
  const request = useRequestPanelTab();
  const views = useQuery({ queryKey: ["ui-views", client?.baseUrl, owner.kind, owner.id], queryFn: () => client!.listViews(owner), enabled: Boolean(client && owner.id), refetchInterval: 10_000 });
  if (!client || (!views.data?.items.length && !views.data?.issues.length && !views.error)) return null;
  return <div className="wiki-explorer-views"><div className="wiki-section-label"><span>Reports & dashboards</span></div>{views.data?.items.map(view => <FileBrowserRow key={view.id} style={{ paddingLeft: 6 }} onClick={() => request(viewPanelTab(client.baseUrl, { owner, viewId: view.id }, view.title))} leading={<span className="size-3.5 shrink-0" />} icon={view.mode === "dashboard" ? <ChartNoAxesCombined className="size-5 shrink-0 text-muted-foreground" /> : <FileChartColumn className="size-5 shrink-0 text-muted-foreground" />}>{view.title}</FileBrowserRow>)}{views.data?.issues.map(issue => <p key={issue.path} role="status" className="px-3 py-2 text-xs text-destructive"><strong className="block truncate" title={issue.path}>{issue.path.split("/").at(-1)}</strong>{issue.message}</p>)}{views.error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{views.error.message}</p>}</div>;
}
