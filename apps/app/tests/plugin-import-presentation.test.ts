import { expect, test } from "bun:test";
import { groupPluginImportCandidates, pluginImportConnectorName, pluginImportName, pluginImportSkillName } from "../src/react-app/domains/settings/pages/plugin-import-presentation";
import { readWorkspaceImports } from "../src/app/lib/extension-imports";

test("provider display names hide internal app IDs without changing plugin identity", () => {
  expect(pluginImportName({ name: "app-6a9a3c1cd0108191807da33c4cd319ed", displayName: "Clerk" })).toBe("Clerk");
  expect(pluginImportName({ name: "google-drive" })).toBe("Google Drive");
  const skill = { name: "patent-studio-2cbe85ce-claim-review", path: "/home/skills/patent-studio-2cbe85ce-plugin/patent-studio-2cbe85ce-claim-review/SKILL.md" };
  expect(pluginImportSkillName(skill)).toBe("Claim Review");
  expect(pluginImportSkillName({ ...skill, path: skill.path.replace("/SKILL.md", "") })).toBe("Claim Review");
  expect(skill.name).toBe("patent-studio-2cbe85ce-claim-review");
  expect(pluginImportSkillName({ ...skill, path: "/home/skills/custom/SKILL.md" })).toBe(skill.name);
  expect(pluginImportSkillName({ ...skill, path: skill.path.replace(/\//g, "\\") })).toBe("Claim Review");
});

test("discovery groups copies by canonical identity and keeps the latest version plus all source choices", () => {
  const groups = groupPluginImportCandidates([
    { name: "search", displayName: "Search", path: "/cache/old", version: "1.9" },
    { name: "search", displayName: "Search", path: "/cache/new", version: "1.10" },
    { name: "other-search", displayName: "Search", path: "/cache/other", version: "1" },
  ]);
  expect(groups).toHaveLength(2);
  const search = groups.find(group => group.candidate.name === "search");
  expect(search?.candidate.path).toBe("/cache/new");
  expect(search?.sources.map(source => source.path)).toEqual(["/cache/new", "/cache/old"]);
});

test("installed package parsing retains its display name and all-projects scope", () => {
  const imports = readWorkspaceImports({ cloudImports: { plugins: { internal: {
    pluginId: "internal", name: "app-internal", displayName: "Clerk", scope: "global", files: [],
  } } } });
  expect(imports.plugins.internal?.name).toBe("app-internal");
  expect(imports.plugins.internal?.displayName).toBe("Clerk");
  expect(imports.plugins.internal?.scope).toBe("global");
});

test("connector discovery keeps same-name services and same-file entries independently selectable", () => {
  const groups = groupPluginImportCandidates([
    { name: "search", path: "/home/.claude.json", version: null, kind: "connector", connector: { name: "search" } },
    { name: "search", path: "/home/.claude.json", version: null, kind: "connector", connector: { name: "search", project: "/project" } },
    { name: "docket", path: "/home/.claude.json", version: null, kind: "connector", connector: { name: "docket" } },
    { name: "search", path: "/plugin", version: "1", kind: "plugin" },
  ]);
  expect(groups).toHaveLength(4);
  expect(pluginImportConnectorName("connector-search-abcdef12-12345678-plugin-global-patent-search-abcdef")).toBe("Patent Search");
  expect(pluginImportConnectorName("custom-search")).toBe("custom-search");
});
