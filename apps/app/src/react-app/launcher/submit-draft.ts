import type { AssistantSubmitInput } from "@legalwork/types/launcher";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { DraftCoordinator } from "./draft-coordinator";
import { createSubmissionIdentity } from "./submission-identity";

/** Every Assistant surface sends and retries the same frozen operation. */
export async function submitAssistantDraft(options: {
  client: Pick<LegalworkServerClient, "submitAssistantMessage">;
  drafts: DraftCoordinator; conversationId: string; owner: string;
  input: Omit<AssistantSubmitInput, "requestId" | "messageId">; retry?: boolean;
  identity?: { requestId: string; messageId: string };
}) {
  const { client, drafts, conversationId, owner } = options;
  await drafts.flush();
  await drafts.reconcile();
  if (!drafts.owns(conversationId, owner)) throw new Error("Focus this conversation before sending; it is being edited in another window.");
  return drafts.protect(conversationId, owner, async () => {
    const draft = drafts.get(conversationId);
    const pending = draft.submission;
    const retrying = Boolean(pending?.input && (options.retry || pending.state === "unconfirmed" || pending.state === "sending"));
    const reuse = retrying && pending?.state !== "failed";
    const candidate = retrying && pending?.input ? pending.input : options.input;
    const input = reuse && pending?.input ? pending.input : { ...candidate, ...(options.identity ?? createSubmissionIdentity()) };
    const draftSnapshot = retrying ? pending?.draftSnapshot : { text: draft.text, context: draft.context };
    const operation = { requestId: input.requestId, messageId: input.messageId, input, draftSnapshot };
    await drafts.update(conversationId, owner, { submission: { ...operation, state: "sending" } });
    try {
      const { submission } = await client.submitAssistantMessage(conversationId, input);
      const accepted = submission.state === "accepted" || submission.state === "running" || submission.state === "completed";
      const current = drafts.get(conversationId);
      // A retry acknowledges the frozen draft, not edits made after the first attempt.
      const unchanged = draftSnapshot && current.text === draftSnapshot.text && JSON.stringify(current.context) === JSON.stringify(draftSnapshot.context);
      await drafts.update(conversationId, owner, {
        ...(accepted && unchanged ? { text: "", context: [], pendingTranscription: null, composer: undefined } : {}),
        submission: { ...operation, state: submission.state },
      });
      return submission;
    } catch (error) {
      const refused = error instanceof Error && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408;
      await drafts.update(conversationId, owner, { submission: { ...operation, state: refused ? "failed" : "unconfirmed" } }).catch(() => undefined);
      throw error;
    }
  });
}
