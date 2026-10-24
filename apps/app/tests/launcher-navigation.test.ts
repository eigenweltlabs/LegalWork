import { expect, test } from "bun:test";
import { LauncherNavigationHistory, type NavigationEntry } from "../src/react-app/launcher/launcher-navigation";

const home: NavigationEntry = { view: "idle", detail: null, input: "", category: null, fileFilter: { types: null, modifiedAfter: null }, scope: null, selection: { id: "home:new", source: "user" }, conversation: null, context: [], target: { kind: "assistant" }, previews: [] };
const conversation = (id: string): NavigationEntry["conversation"] => ({ conversationId: id, workspaceId: "assistant", sessionId: `session-${id}`, title: id, archived: false, pinned: false });

test("Escape restores the search and selected row underneath a chat", () => {
  const history = new LauncherNavigationHistory();
  const search: NavigationEntry = { ...home, view: "results", input: "lease", category: "files", selection: { id: "file-b", source: "user" } };
  history.observe(search);
  const chat: NavigationEntry = { ...home, view: "conversation", input: "Compare these", conversation: conversation("new") };
  history.observe(chat);
  expect(history.back(chat)).toEqual({ ...search, conversation: chat.conversation });
});

test("ask prefixes cannot route back into the conversation in a loop", () => {
  const history = new LauncherNavigationHistory();
  history.observe(home);
  history.observe({ ...home, input: "? hello" });
  const chat: NavigationEntry = { ...home, view: "conversation", input: "hello", conversation: conversation("a") };
  history.observe(chat);
  expect(history.back(chat)).toMatchObject({ view: "idle", detail: null, input: "" });
});

test("chat A through Work and chat B returns to A with the correct draft identity", () => {
  const history = new LauncherNavigationHistory();
  const a: NavigationEntry = { ...home, view: "conversation", input: "draft A", conversation: conversation("a") };
  const work: NavigationEntry = { ...a, view: "work", input: "" };
  const b: NavigationEntry = { ...a, conversation: conversation("b"), input: "draft B" };
  history.observe(home); history.observe(a); history.observe(work); history.observe(b);
  const backToWork = history.back(b);
  expect(backToWork.view).toBe("work");
  history.observe(backToWork);
  const backToA = history.back(backToWork);
  expect(backToA).toMatchObject({ view: "conversation", input: "draft A", conversation: { conversationId: "a" } });
  history.observe(backToA);
  expect(history.back(backToA).view).toBe("idle");
});

// Opening History must replace the start list, with an independent keyboard selection.
test("History returns to the chosen entry after opening a chat and then to the start list", () => {
  const history = new LauncherNavigationHistory();
  const start: NavigationEntry = { ...home, selection: { id: "home:history", source: "user" } };
  const list: NavigationEntry = { ...home, view: "history", selection: { id: "home:chat:a", source: "user" } };
  const chat: NavigationEntry = { ...home, view: "conversation", conversation: conversation("a") };
  history.observe(start); history.observe(list); history.observe(chat);
  const restored = history.back(chat);
  expect(restored).toMatchObject({ view: "history", selection: { id: "home:chat:a" } });
  history.observe(restored);
  expect(history.back(restored)).toMatchObject({ view: "idle", selection: { id: "home:history" } });
});
