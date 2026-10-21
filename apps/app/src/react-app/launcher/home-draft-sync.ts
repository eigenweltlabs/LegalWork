import { useEffect, useRef } from "react";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { createProjectAttachmentMention, createWorkspaceAttachmentMention } from "@/react-app/domains/session/surface/composer/workspace-attachment";
import type { LauncherDraft } from "@legalwork/types/launcher";
import { sharedDraftCoordinator, windowOwnerId } from "./launcher-route";

/** The panel's complete draft as Home composer text: file references become attachment mentions, captured text is quoted. */
export function launcherDraftToComposerText(draft: Pick<LauncherDraft, "text" | "context">, assistantWorkspaceId: string, projectNames: Map<string, string>) {
  const parts = [draft.text.trim()];
  for (const item of draft.context) {
    if (item.type === "file" && item.path) parts.push(item.workspaceId && item.workspaceId !== assistantWorkspaceId ? createProjectAttachmentMention({ projectId: item.workspaceId, workspaceId: item.workspaceId, path: item.path, name: item.name }, projectNames.get(item.workspaceId) ?? item.sourceLabel ?? item.workspaceId) : createWorkspaceAttachmentMention(item.name, item.path));
    else if (item.type === "image" && item.path) parts.push(createWorkspaceAttachmentMention(item.name, item.path));
    else if (item.type === "selection") parts.push(`${item.sourceApp ? `${item.sourceApp}${item.sourceWindow ? ` (${item.sourceWindow})` : ""}:\n` : ""}"""\n${item.text}\n"""`);
    else if (item.type === "clipboard") parts.push(`"""\n${item.text}\n"""`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Home continuity for an Assistant chat: focusing the composer claims the
 * shared draft lease and shows the panel's complete draft; typing while
 * owning it keeps the panel current. Sending clears it through the normal path.
 */
export function useHomeDraftSync(input: { active: boolean; conversationId: string | null; sessionId: string | null; assistantWorkspaceId: string | null; projectNames: Map<string, string> }) {
  const owner = useRef(windowOwnerId("home"));
  const drafts = sharedDraftCoordinator();
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const { active, conversationId, sessionId, assistantWorkspaceId } = input;
    if (!active || !conversationId || !sessionId || !assistantWorkspaceId) return;
    let disposed = false;
    const claim = async () => {
      const { draft } = await drafts.claim(conversationId, owner.current);
      if (disposed) return;
      const key = `${conversationId}:${draft.revision}`;
      if (applied.current === key) return;
      applied.current = key;
      const text = launcherDraftToComposerText(draft, assistantWorkspaceId, input.projectNames);
      const composer = useComposerStateStore.getState();
      if (text && composer.sessions[sessionId]?.draft !== text) composer.setDraft(sessionId, text);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[data-lw-composer], .lw-composer, [contenteditable=\"true\"]")) void claim();
    };
    document.addEventListener("focusin", onFocus);
    void claim();
    const unsubscribe = useComposerStateStore.subscribe((state, previous) => {
      const current = state.sessions[sessionId]?.draft ?? "";
      if (current === (previous.sessions[sessionId]?.draft ?? "") || !drafts.owns(conversationId, owner.current)) return;
      void drafts.update(conversationId, owner.current, { text: current }).catch(() => undefined);
    });
    const unsubscribeDrafts = drafts.subscribe(id => { if (id === conversationId && !drafts.owns(conversationId, owner.current)) applied.current = null; });
    return () => { disposed = true; document.removeEventListener("focusin", onFocus); unsubscribe(); unsubscribeDrafts(); };
    // Rebind only when the conversation or session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.active, input.conversationId, input.sessionId, input.assistantWorkspaceId]);
}
