import { useQuery } from "@tanstack/react-query";
import type { ViewOwner } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

type ViewSaveDestination = { owner: ViewOwner; name: string };

export function useViewSaveDestinations(client: LegalworkServerClient) {
  return useQuery({ queryKey: ["view-save-destinations", client.baseUrl], queryFn: async () => {
    const [projects, wikis] = await Promise.all([client.listWorkspaces(), client.listWikis()]);
    return [
      ...projects.items.filter(project => project.workspaceType !== "remote" && !wikis.items.some(wiki => wiki.workspaceId === project.id))
        .map(project => ({ owner: { kind: "workspace", id: project.id } satisfies ViewOwner, name: project.displayName || project.name })),
      ...wikis.items.filter(wiki => wiki.writable).map(wiki => ({ owner: { kind: "wiki", id: wiki.id } satisfies ViewOwner, name: wiki.name })),
    ];
  } });
}

export function viewSaveDestinationGroups(destinations: ViewSaveDestination[] = []) {
  return [
    { kind: "workspace", label: t("projects.plural"), items: destinations.filter(item => item.owner.kind === "workspace") },
    { kind: "wiki", label: t("views.wikis"), items: destinations.filter(item => item.owner.kind === "wiki") },
  ].filter(group => group.items.length > 0);
}
