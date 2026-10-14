import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { ViewReference } from "./view-reference";
import { t } from "@/i18n";

/** Show the chosen destination by name; persistence is a separate explicit action. */
export function ViewLocation({ client, reference }: { client: LegalworkServerClient; reference: ViewReference }) {
  const { owner } = reference;
  const name = useQuery({ queryKey: ["view-owner-name", client.baseUrl, owner.kind, owner.id], queryFn: async () => {
    if (owner.kind === "wiki") return (await client.listWikis()).items.find(wiki => wiki.id === owner.id)?.name;
    const workspace = (await client.listWorkspaces()).items.find(workspace => workspace.id === owner.id);
    return workspace?.displayName || workspace?.name;
  } });
  return <div className="flex items-start gap-2 border-b px-4 py-2 text-xs text-muted-foreground" role="status">
    <MapPin className="mt-0.5 size-3.5 shrink-0" /><div className="min-w-0"><span>{t("views.saved_in")} {t(owner.kind === "wiki" ? "wiki.title" : "views.project_location")} · {name.data ?? (name.isPending ? "…" : t("views.location_unavailable"))}</span>
    </div>
  </div>;
}
