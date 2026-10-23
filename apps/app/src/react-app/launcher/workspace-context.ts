import { workspaceContextSnapshot } from "./workspace-context-model";
import { useEffect, useRef } from "react";
import type { LauncherWorkspaceContext } from "@legalwork/types/launcher";
import { launcherWindowControl } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { usePanelTabStore, workspacePanelKey } from "@/react-app/domains/session/panel/panel-tab-store";
import { launcherFolderForWorkspace } from "@/react-app/domains/session/panel/workspace-files-panel";

const lastDocument = new Map<string, string | null>();
export function readWorkspaceContext(workspace: { id: string; name: string } | null): LauncherWorkspaceContext | null {
  if (!workspace) return null;
  const result = workspaceContextSnapshot({ workspace, panel: usePanelTabStore.getState().sessions[workspacePanelKey(workspace.id)], folder: launcherFolderForWorkspace(workspace.id), selection: window.getSelection()?.toString(), lastDocumentId: lastDocument.get(workspace.id), now: Date.now() });
  lastDocument.set(workspace.id, result.documentId);
  return result.context;
}

/** Publish only this window's state. The desktop chooses the focused window at invocation. */
export function usePublishLauncherContext(workspace: { id: string; name: string } | null) {
  const latest = useRef(workspace);
  latest.current = workspace;
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const publish = () => { if (document.hasFocus()) void launcherWindowControl("context", { context: readWorkspaceContext(latest.current) }).catch(() => undefined); };
    publish();
    const unsubscribe = usePanelTabStore.subscribe(publish);
    window.addEventListener("focus", publish);
    document.addEventListener("selectionchange", publish);
    window.addEventListener("legalwork:folder-changed", publish);
    return () => { unsubscribe(); window.removeEventListener("focus", publish); document.removeEventListener("selectionchange", publish); window.removeEventListener("legalwork:folder-changed", publish); };
  }, [workspace?.id, workspace?.name]);
}
