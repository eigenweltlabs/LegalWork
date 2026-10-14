import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { ViewReference } from "./view-reference";
import { useSavedViews } from "./view-list";
import { t } from "@/i18n";

/** Resolve the indexed file path, including dashboards moved out of their default folder. */
export function ViewLocation({ client, reference }: { client: LegalworkServerClient; reference: ViewReference }) {
  const { owner } = reference;
  const views = useSavedViews(client, owner);
  const name = useQuery({ queryKey: ["view-owner-name", client.baseUrl, owner.kind, owner.id], queryFn: async () => {
    if (owner.kind === "wiki") return (await client.listWikis()).items.find(wiki => wiki.id === owner.id)?.name;
    const workspace = (await client.listWorkspaces()).items.find(workspace => workspace.id === owner.id);
    return workspace?.displayName || workspace?.name;
  } });
  const path = views.data?.items.find(view => view.id === reference.viewId)?.path;
  return <div className="flex items-start gap-2 border-b px-4 py-2 text-xs text-muted-foreground" role="status">
    <MapPin className="mt-0.5 size-3.5 shrink-0" /><div className="min-w-0"><span>{t("views.saved_in")} {t(owner.kind === "wiki" ? "wiki.title" : "views.project_location")} · {name.data ?? (name.isPending ? "…" : t("views.location_unavailable"))}</span>
    <p className="mt-0.5 select-text break-all">{path ?? (views.isPending ? t("wiki.loading") : t("views.location_unavailable"))}</p></div>
  </div>;
}
