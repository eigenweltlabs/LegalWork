import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { storageInputSchema } from "@legalwork/types/file-storage";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { SkillsView, type SkillsExtensionsStore } from "../src/react-app/domains/settings/pages/skills-view";
import { BuiltInSkills } from "../src/react-app/domains/settings/pages/skill-packages";
import { FileStorageView } from "../src/react-app/domains/settings/pages/file-storage-view";
import { HubScopeContext } from "../src/react-app/domains/settings/pages/hub-scope-context";

const noop = () => {};
const ok = async () => ({ ok: true, message: "" });
const unused = async (): Promise<never> => { throw new Error("Must not execute during rendering"); };
const skills = Array.from({ length: 13 }, (_, index) => ({ name: `skill-${index + 1}`, path: `/skills/skill-${index + 1}`, description: `Skill number ${index + 1}` }));
const extensions: SkillsExtensionsStore = {
  skills: () => skills, skillsStatus: () => null, hubSkills: () => [], hubSkillsStatus: () => null, hubRepo: () => null, hubRepos: () => [],
  ensureHubSkillsFresh: noop, refreshSkills: noop, refreshHubSkills: noop, setHubRepo: noop, addHubRepo: noop, removeHubRepo: noop,
  installSkillCreator: ok, installHubSkill: ok, importLocalSkill: noop, importLocalSkillZip: noop, scanGithubSkills: unused, importGithubSkills: ok,
  revealSkillsFolder: noop, readSkill: async () => null, saveSkill: noop, createSkill: ok, uninstallSkill: noop, exportSkillZip: ok,
  importedPackages: async () => [], removeImportedPackage: async () => {}, previewClaudePlugin: unused, installClaudePlugin: ok, readFirmSkill: unused,
  skillResources: () => [], skillResourcesStatus: () => null, refreshSkillResources: noop, readSkillResource: async () => null, saveSkillResource: ok, deleteSkillResource: ok,
};

function renderSkills(kind: "skills" | "workflows" = "skills") {
  return renderToStaticMarkup(<SkillsView workspaceName="Test" busy={false} showHeader={false} canInstallSkillCreator canUseDesktopTools extensions={extensions} onOpenLink={noop} createSessionAndOpen={noop} kind={kind} />);
}

test("ordinary skills expose the full library beyond the workflow page size", () => {
  const html = renderSkills();
  for (const skill of skills) expect(html).toContain(`>${skill.name}<`);
  expect(html).toContain('aria-label="Actions for skill-13"');
  expect(html).not.toContain("Page 1 /");
});

test("skills stay separate from workflows and include built-in expertise", () => {
  expect(renderSkills()).toContain("DOCX Redline");
  expect(renderSkills()).toContain("PDF Tools");
  const workflowHtml = renderSkills("workflows");
  expect(workflowHtml).not.toContain("DOCX Redline");
  expect(workflowHtml).not.toContain(">skill-13<");
});

test("built-in search includes commands and omits unrelated entries", () => {
  const html = renderToStaticMarkup(<BuiltInSkills searchQuery="/fill-form" />);
  expect(html).toContain("PDF Tools");
  expect(html).not.toContain("DOCX Redline");
  expect(renderToStaticMarkup(<BuiltInSkills searchQuery="no-match" showEmpty />)).toContain("No matching skills");
});

function renderStorage(team = false, empty = false) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const connection = { ...storageInputSchema.parse({ name: "Office documents", config: { kind: "webdav", endpoint: "https://example.invalid/files" } }), id: "docs", updatedAt: 1, configuredSecrets: [] };
  queries.setQueryData(["storage-connections", "test"], { connections: empty ? [] : [connection] });
  queries.setQueryData(["storage-oauth-providers", "test"], { providers: [] });
  const html = renderToStaticMarkup(<QueryClientProvider client={queries}><HubScopeContext.Provider value={team ? "team" : "local"}><FileStorageView client={createLegalworkServerClient({ baseUrl: "https://example.invalid" })} workspaceId="test" /></HubScopeContext.Provider></QueryClientProvider>);
  queries.clear();
  return html;
}

test("storage leads with connected accounts and keeps the provider catalog out of the library", () => {
  const html = renderStorage();
  expect(html).toContain("Office documents");
  expect(html).toContain("Search storage");
  expect(html).toContain("Your storage");
  expect(html).not.toContain("SFTP");
  expect(html).not.toContain("https://example.invalid/files");
});

test("storage empty and team states preserve scope and offer the right next action", () => {
  expect(renderStorage(false, true)).toContain("Your documents, within reach");
  const teamHtml = renderStorage(true);
  expect(teamHtml).not.toContain("Office documents");
  expect(teamHtml).not.toContain(">Add storage<");
  expect(teamHtml).toContain("No shared storage yet");
});
