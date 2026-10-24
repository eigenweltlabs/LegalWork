import type { LauncherSearchResult } from "@legalwork/types/launcher";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

export function canCopyLauncherResult(result: LauncherSearchResult, localFiles: boolean) {
  return result.kind === "files" ? localFiles : result.kind === "tasks" || result.kind === "recordings";
}

/** Copy complete source text, rather than the truncated search excerpt. */
export async function launcherClipboardText(result: LauncherSearchResult, client: Pick<LegalworkServerClient, "getTask" | "recordingTranscript">) {
  if (result.kind === "tasks") {
    const { task, notes } = await client.getTask(result.workspaceId ?? "", result.id);
    return [task.title, task.description, ...notes.map(note => note.body)].filter(Boolean).join("\n\n");
  }
  if (result.kind === "recordings") {
    const parts: string[] = [];
    let offset = 0;
    while (true) {
      const page = await client.recordingTranscript(result.id, { offset, limit: 20000 });
      parts.push(page.content);
      if (page.nextOffset === null) break;
      if (page.nextOffset <= offset) throw new Error(t("launcher.notice.copy_failed"));
      offset = page.nextOffset;
    }
    const transcript = parts.join("");
    if (!transcript.trim()) throw new Error(t("launcher.notice.transcript_unavailable"));
    return transcript;
  }
  throw new Error(t("launcher.notice.copy_failed"));
}
