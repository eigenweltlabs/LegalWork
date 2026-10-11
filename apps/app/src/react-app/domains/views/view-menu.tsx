import { useQuery } from "@tanstack/react-query";
import { FileChartColumn } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { viewPanelTab, type ViewPanelTab } from "./view-reference";

export function ViewMenu({ client, workspaceId, onOpen }: { client: LegalworkServerClient; workspaceId: string; onOpen: (tab: ViewPanelTab) => void }) {
  const views = useQuery({ queryKey: ["ui-views", client.baseUrl, "workspace", workspaceId], queryFn: () => client.listViews({ kind: "workspace", id: workspaceId }), staleTime: 10_000 });
  return <DropdownMenuSub><DropdownMenuSubTrigger><FileChartColumn />Reports</DropdownMenuSubTrigger><DropdownMenuSubContent>{views.data?.items.length ? views.data.items.map(view => <DropdownMenuItem key={view.id} onClick={() => onOpen(viewPanelTab(client.baseUrl, { owner: view.owner, viewId: view.id }, view.title))}>{view.title}</DropdownMenuItem>) : !views.data?.issues.length && <DropdownMenuItem disabled>{views.isPending ? "Loading…" : views.error ? "Reports unavailable" : "Ask your agent to create a report"}</DropdownMenuItem>}{views.data?.issues.map(issue => <div key={issue.path} role="status" className="max-w-72 px-2 py-2 text-xs text-destructive"><strong className="block truncate" title={issue.path}>{issue.path.split("/").at(-1)}</strong>{issue.message}</div>)}</DropdownMenuSubContent></DropdownMenuSub>;
}
