import { expect, test } from "bun:test";
import { useLauncherStore } from "../src/react-app/launcher/launcher-store";

const conversation = { id: "conv_1", workspaceId: "assistant", sessionId: "ses_1", title: "Müller", kind: "conversation" as const, date: null, createdAt: 1, updatedAt: 1, pinned: false, archivedAt: null, origin: null };
test("hiding the panel clears a typed search but keeps a conversation draft", () => {
  const store = useLauncherStore.getState();
  store.bindConversation(conversation);
  store.setCategory("files"); store.setInput("Mietvertrag"); store.setView("results");
  store.reset();
  expect(useLauncherStore.getState()).toMatchObject({ view: "idle", input: "", category: null });
  store.setInput("Was ist offen?"); store.setView("conversation");
  store.reset();
  expect(useLauncherStore.getState()).toMatchObject({ view: "conversation", input: "Was ist offen?" });
  expect(useLauncherStore.getState().conversation?.pinned).toBe(false);
});
