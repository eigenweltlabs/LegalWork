/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";
import { EngineProjectApproval, engineProjectStatusQueryKey } from "../workspace/engine-project-approval";
import { OnboardingCover } from "./onboarding-cover";

/** Project review must be reachable before AI setup needs the native catalog. */
export function ProjectSetupGate(props: {
  client: LegalworkServerClient | null;
  workspaceId: string | null;
  onApproved: () => void;
  children: ReactNode;
}) {
  const { client, workspaceId } = props;
  const status = useQuery({
    queryKey: client && workspaceId ? engineProjectStatusQueryKey(client, workspaceId) : ["engine-project-status", "onboarding-disconnected"],
    enabled: Boolean(client && workspaceId), retry: false,
    queryFn: () => {
      if (!client || !workspaceId) throw new Error("A connected project is required for setup.");
      return client.getEngineProjectStatus(workspaceId);
    },
  });
  if (status.data?.state === "ready") return props.children;
  return <OnboardingCover compact>
    {client && workspaceId
      ? <EngineProjectApproval client={client} workspaceId={workspaceId} onApproved={props.onApproved} />
      : <p role="status">{t("ai_plans.server_starting")}</p>}
  </OnboardingCover>;
}
