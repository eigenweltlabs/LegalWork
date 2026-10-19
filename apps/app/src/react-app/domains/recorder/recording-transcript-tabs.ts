import { useEffect, useRef } from "react";
import type { AudioRecordingMeta } from "@legalwork/types/audio";
import { requestPanelTab } from "../session/panel/panel-tab-request";
import { type RecordingPanelTab, usePanelTabStore } from "../session/panel/panel-tab-store";
import { useRecorderStore } from "./recorder-store";

export function recordingTranscriptTab(recording: Pick<AudioRecordingMeta, "id" | "title">): RecordingPanelTab {
  return { id: `recording:${recording.id}`, type: "recording", recordingId: recording.id, label: recording.title };
}

export function requestRecordingTranscript(recording: AudioRecordingMeta, workspaceId?: string | null): void {
  if (recording.ephemeral || !workspaceId) return;
  requestPanelTab(recordingTranscriptTab(recording), { kind: "workspace", workspaceId });
}

export function closeRecordingTranscriptTabs(recordingId: string): void {
  const store = usePanelTabStore.getState();
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    for (const tab of session.tabs) {
      if (tab.type === "recording" && tab.recordingId === recordingId) store.closeTab(sessionId, tab.id);
    }
  }
}

/** Open workspace transcripts once per new capture. Navigation never stops capture. */
export function useAutoOpenRecordingTranscript(workspaceId?: string | null): void {
  const recording = useRecorderStore(state => state.recording);
  const dictationId = useRecorderStore(state => state.dictationRecordingId);
  const opened = useRef<string | null>(recording?.id ?? null);
  useEffect(() => {
    if (!recording || recording.ephemeral || recording.id === dictationId || opened.current === recording.id) return;
    // Observe global captures too, so entering a workspace later does not
    // unexpectedly open an already-running recording there.
    opened.current = recording.id;
    requestRecordingTranscript(recording, recording.projectIds?.[0] ?? workspaceId);
  }, [recording, dictationId, workspaceId]);
}
