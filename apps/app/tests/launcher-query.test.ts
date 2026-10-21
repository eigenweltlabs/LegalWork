import { expect, test } from "bun:test";
import { DEFAULT_LAUNCHER_ALIASES } from "@legalwork/types/launcher";
import { activateCategoryAlias, launcherAliasCollisions, looksLikeQuestion, normalizeLauncherAliases, parseLauncherEntry } from "../src/react-app/launcher/launcher-query";

test("an exact alias plus its delimiter becomes a category; bare letters and prose stay text", () => {
  expect(activateCategoryAlias("f Mietvertrag", DEFAULT_LAUNCHER_ALIASES)).toEqual({ category: "files", rest: "Mietvertrag" });
  expect(activateCategoryAlias("p ", DEFAULT_LAUNCHER_ALIASES)).toEqual({ category: "projects", rest: "" });
  expect(activateCategoryAlias("f", DEFAULT_LAUNCHER_ALIASES)).toBeNull();
  expect(activateCategoryAlias("f", DEFAULT_LAUNCHER_ALIASES, "tab")).toEqual({ category: "files", rest: "" });
  expect(activateCategoryAlias("fr Mietvertrag", DEFAULT_LAUNCHER_ALIASES)).toBeNull();
  expect(activateCategoryAlias("Fristen für Müller", DEFAULT_LAUNCHER_ALIASES)).toBeNull();
  expect(activateCategoryAlias("Der Mieter f zahlt", DEFAULT_LAUNCHER_ALIASES)).toBeNull();
  expect(activateCategoryAlias("f\nMietvertrag", DEFAULT_LAUNCHER_ALIASES)).toBeNull();
  const custom = normalizeLauncherAliases({ files: "dok", projects: "P ", tasks: "toolong", chats: "" });
  expect(custom).toEqual({ ...DEFAULT_LAUNCHER_ALIASES, files: "dok", projects: "p" });
  expect(activateCategoryAlias("dok Vertrag", custom)).toEqual({ category: "files", rest: "Vertrag" });
  expect(launcherAliasCollisions({ ...DEFAULT_LAUNCHER_ALIASES, tasks: "f" })).toEqual([{ alias: "f", kinds: ["files", "tasks"] }]);
});

test("slash commands and explicit asks are separate modes; question-shaped text is still a search", () => {
  expect(parseLauncherEntry("/compare a b")).toEqual({ mode: "command", text: "compare a b" });
  expect(parseLauncherEntry("? Was ist im Fall Müller offen?")).toEqual({ mode: "ask", text: "Was ist im Fall Müller offen?" });
  expect(parseLauncherEntry("?")).toEqual({ mode: "ask", text: "" });
  expect(parseLauncherEntry("Was ist offen?")).toEqual({ mode: "search", text: "Was ist offen?" });
  expect(looksLikeQuestion("Was ist offen?")).toBe(true);
  expect(looksLikeQuestion("Mietvertrag Müller")).toBe(false);
});
