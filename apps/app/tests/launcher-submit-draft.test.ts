import { expect, test } from "bun:test";
import type { AssistantConversation, AssistantSubmitInput, AssistantSubmission } from "@legalwork/types/launcher";
import { DraftCoordinator, EMPTY_DRAFT_FILE } from "../src/react-app/launcher/draft-coordinator";
import { submitAssistantDraft } from "../src/react-app/launcher/submit-draft";
import { useLauncherStore } from "../src/react-app/launcher/launcher-store";

const conversation: AssistantConversation = { id: "one", sessionId: "session", workspaceId: "assistant", title: "One", kind: "conversation", date: null, createdAt: 1, updatedAt: 1, pinned: false, archivedAt: null, origin: "home" };

test("HTTP success with unconfirmed delivery retains the payload; Home retries the exact Panel operation", async () => {
  let file = structuredClone(EMPTY_DRAFT_FILE);
  const storage = { read: async () => structuredClone(file), write: async (next: typeof file, expected: number) => { if (file.version !== expected) return false; file = structuredClone(next); return true; } };
  const panel = new DraftCoordinator(storage), home = new DraftCoordinator(storage);
  await panel.claim("one", "panel");
  await panel.update("one", "panel", { text: "Original", target: { kind: "project", workspaceId: "mueller" } });
  const sent: AssistantSubmitInput[] = [];
  const client = { submitAssistantMessage: async (_id: string, input: AssistantSubmitInput) => {
    sent.push(input);
    const submission: AssistantSubmission = { ...input, conversationId: "one", workspaceId: "assistant", sessionId: "session", state: sent.length === 1 ? "unconfirmed" : "accepted", createdAt: 1, updatedAt: 1, error: null, preview: input.text, target: input.context?.target ?? { kind: "assistant" } };
    return { conversation, submission };
  } };
  await submitAssistantDraft({ client, drafts: panel, owner: "panel", conversationId: "one", input: { text: "Original", context: { items: [], target: { kind: "project", workspaceId: "mueller" }, searchScope: null, capturedAt: 1 } } });
  expect(panel.get("one").text).toBe("Original");
  expect(panel.get("one").submission?.state).toBe("unconfirmed");
  await home.claim("one", "home");
  await submitAssistantDraft({ client, drafts: home, owner: "home", conversationId: "one", input: { text: "changed after losing acknowledgement" } });
  expect(sent[1]).toEqual(sent[0]);
  expect(home.get("one").text).toBe("");
  await expect(submitAssistantDraft({ client, drafts: panel, owner: "panel", conversationId: "one", input: { text: "stale" } })).rejects.toThrow("another window");
});

test("switching conversations replaces context and target, including an empty destination draft", () => {
  const store = useLauncherStore.getState();
  store.bindConversation(conversation);
  store.setInput("Müller draft"); store.setTarget({ kind: "project", workspaceId: "mueller" });
  store.addContext([{ id: "file", type: "file", workspaceId: "mueller", path: "secret.txt", name: "secret.txt", revision: null, sourceLabel: null }]);
  store.bindConversation({ ...conversation, id: "two", sessionId: "other" });
  expect(useLauncherStore.getState()).toMatchObject({ input: "", context: [], target: { kind: "assistant" }, scope: null });
});

test("acknowledging an earlier send preserves edits made during delivery or before retry", async () => {
  let file = structuredClone(EMPTY_DRAFT_FILE);
  const drafts = new DraftCoordinator({ read: async () => structuredClone(file), write: async (next, version) => {
    if (file.version !== version) return false;
    file = structuredClone(next); return true;
  } });
  await drafts.claim("one", "home");
  await drafts.update("one", "home", { text: "Original" });
  const sent: AssistantSubmitInput[] = [];
  const client = { submitAssistantMessage: async (_id: string, input: AssistantSubmitInput) => {
    sent.push(input);
    // Typing remains possible while a request is in flight.
    await drafts.update("one", "home", { text: "Next question" });
    const submission: AssistantSubmission = { ...input, conversationId: "one", workspaceId: "assistant", sessionId: "session", state: sent.length === 1 ? "unconfirmed" : "accepted", createdAt: 1, updatedAt: 1, error: null, preview: input.text, target: { kind: "assistant" } };
    return { conversation, submission };
  } };
  await submitAssistantDraft({ client, drafts, owner: "home", conversationId: "one", input: { text: "Original" } });
  await submitAssistantDraft({ client, drafts, owner: "home", conversationId: "one", retry: true, input: { text: "Next question" } });
  expect(sent[1]).toEqual(sent[0]);
  expect(drafts.get("one").text).toBe("Next question");
});
