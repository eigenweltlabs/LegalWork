import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AssistantProfile } from "@legalwork/types/main-assistant";
import type { LegalworkServerClient, LegalworkWorkspaceInfo } from "@/app/lib/legalwork-server";
import { CommandDialog, CommandDialogPopup, CommandDialogTitle } from "@/components/ui/command";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { t } from "@/i18n";
import { LauncherPanel } from "./launcher-panel";
import { sharedDraftCoordinator, windowOwnerId } from "./launcher-route";
import { LauncherShellContext, type LauncherShellValue } from "./launcher-shell";
import { useLauncherStore } from "./launcher-store";
import "@/react-app/shell/command-palette.css";

/** The same panel inside the main window (Cmd/Ctrl+K): identical results, actions and conversation. */
export function LauncherDialog(props: { open: boolean; onClose: () => void; client: LegalworkServerClient; assistant: { workspaceId: string; profile: AssistantProfile } | null; workspaces: LegalworkWorkspaceInfo[]; conversationId: string | null }) {
  const navigate = useNavigate();
  const drafts = useMemo(() => sharedDraftCoordinator(), []);
  const owner = useMemo(() => windowOwnerId("main"), []);
  useEffect(() => { useLauncherStore.getState().setVisible(props.open); if (!props.open) useLauncherStore.getState().reset(); }, [props.open]);
  const shell = useMemo<LauncherShellValue>(() => ({
    client: props.client, assistant: props.assistant, workspaces: props.workspaces, drafts, owner, surface: "embedded", conversationId: props.conversationId, desktop: isDesktopRuntime(),
    openInApp: route => { props.onClose(); navigate(route); }, dismiss: props.onClose, togglePin: null, refresh: async () => undefined,
  }), [props, drafts, owner, navigate]);
  return <CommandDialog open={props.open} onOpenChange={open => { if (!open) props.onClose(); }}>
    <CommandDialogPopup className="search-dialog" backdropClassName="search-backdrop" viewportClassName="search-viewport">
      <CommandDialogTitle>{t("launcher.title")}</CommandDialogTitle>
      <LauncherShellContext.Provider value={shell}>{props.open && <LauncherPanel />}</LauncherShellContext.Provider>
    </CommandDialogPopup>
  </CommandDialog>;
}
