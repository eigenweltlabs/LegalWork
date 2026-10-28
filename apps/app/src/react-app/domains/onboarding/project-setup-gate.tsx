import type { ReactNode } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

/** Project-automation review no longer gates onboarding. */
export function ProjectSetupGate(props: {
  client: LegalworkServerClient | null;
  workspaceId: string | null;
  onApproved: () => void;
  children: ReactNode;
}) {
  return props.children;
}
