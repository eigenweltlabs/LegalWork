import { useEffect, useRef } from "react";
import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ViewGenerationChunk } from "@legalwork/types/views";
import { useMessageList } from "@/components/chat/message-list-provider";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { syncViewGeneration } from "./view-generation-sync";

export function useViewGenerations(messages: UIMessage[]) {
  const { legalworkClient, workspaceId, sessionId } = useMessageList();
  const open = useRequestPanelTab();
  const latest = useRef(messages);
  latest.current = messages;
  const chunks = useRef(new Map<string, ViewGenerationChunk>());
  const openRef = useRef(open);
  openRef.current = open;
  const openBesideChat = (tab: Parameters<typeof open>[0]) => openRef.current(tab, { besideChat: true });
  const seen = useRef(new WeakSet<DynamicToolUIPart>());
  useEffect(() => {
    if (!legalworkClient) return;
    chunks.current.clear();
    const abort = new AbortController();
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => void legalworkClient.viewGenerationEvents(workspaceId, sessionId, chunk => {
      if (!chunks.current.has(chunk.callId) && chunks.current.size >= 16) chunks.current.delete(chunks.current.keys().next().value!);
      chunks.current.set(chunk.callId, chunk);
      // Only a live transcript call can open a preview. Replayed history cannot reopen saved tabs.
      for (const message of latest.current) for (const part of message.parts) {
        if (part.type !== "dynamic-tool" || part.toolCallId !== chunk.callId || (part.state !== "input-streaming" && part.state !== "input-available")) continue;
        void syncViewGeneration({ serverUrl: legalworkClient.baseUrl, workspaceId, sessionId }, {
          ...part, callProviderMetadata: { opencode: { rawInput: chunk.raw } },
        }, openBesideChat);
      }
    }, abort.signal).catch(() => {}).finally(() => { if (!abort.signal.aborted) retry = setTimeout(connect, 2_000); });
    connect();
    return () => { abort.abort(); clearTimeout(retry); };
  }, [legalworkClient, workspaceId, sessionId]);
  useEffect(() => {
    if (!legalworkClient) return;
    for (const message of messages) for (const part of message.parts) {
      if (part.type !== "dynamic-tool" || (part.toolName !== "view_create" && part.toolName !== "view_update") || seen.current.has(part)) continue;
      seen.current.add(part);
      const chunk = chunks.current.get(part.toolCallId);
      void syncViewGeneration({ serverUrl: legalworkClient.baseUrl, workspaceId, sessionId },
        chunk && part.state === "input-streaming" ? { ...part, callProviderMetadata: { opencode: { rawInput: chunk.raw } } } : part, openBesideChat);
    }
  }, [messages, legalworkClient, workspaceId, sessionId, open]);
}
