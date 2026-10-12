import { expect, test } from "bun:test";
import { Plus, Search } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { storageInputSchema } from "@legalwork/types/file-storage";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { SkillsView, type SkillsExtensionsStore } from "../src/react-app/domains/settings/pages/skills-view";
import { BuiltInSkills } from "../src/react-app/domains/settings/pages/skill-packages";
import { FileStorageView } from "../src/react-app/domains/settings/pages/file-storage-view";
import { HubScopeContext } from "../src/react-app/domains/settings/pages/hub-scope-context";
import { IntegrationAddMenu, IntegrationLibraryLayoutContext, IntegrationLibrarySearchContext, type IntegrationLibrarySource } from "../src/react-app/domains/settings/pages/integration-library";
import { HubDownloadSection } from "../src/react-app/domains/settings/pages/hub-download-section";
import { FIRM_HUB_QUERY_KEY } from "../src/react-app/domains/connections/firm-hub";
import { eigenweltEntitlementsQueryKey } from "../src/react-app/domains/connections/eigenwelt-entitlements";

const noop = () => {};
const ok = async () => ({ ok: true, message: "" });
const unused = async (): Promise<never> => { throw new Error("Must not execute during rendering"); };

test("a single Add action is a direct button; alternate creation paths use a menu", () => {
  const add = { label: "New skill", icon: Plus, onClick: noop };
  const single = renderToStaticMarkup(<IntegrationAddMenu actions={[add]} />);
  expect(single).toContain('title="New skill"');
  expect(single).not.toContain('aria-haspopup="menu"');
  expect(single).not.toContain("lucide-chevron-down");
  const multiple = renderToStaticMarkup(<IntegrationAddMenu actions={[{ label: "Browse directory", icon: Search, onClick: noop }, add]} />);
  expect(multiple).toContain('aria-haspopup="menu"');
  expect(multiple).toContain("lucide-chevron-down");
});
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

function renderSkillSources(source: IntegrationLibrarySource, query = "") {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const client = createLegalworkServerClient({ baseUrl: "https://example.invalid" });
  const automatic = { id: "automatic", kind: "skill", name: "team-research", description: "Research shared by the team", createdByUserId: "author", version: 1, updatedAt: "2026-10-12" };
  const offered = { ...automatic, id: "offered", name: "offered-review", description: "Optional team review" };
  queries.setQueryData(eigenweltEntitlementsQueryKey(), { entitlements: { features: ["admin_hub"] }, connected: true });
  queries.setQueryData(["eigenwelt-hub", "skill", "test"], [automatic, offered]);
  queries.setQueryData(FIRM_HUB_QUERY_KEY, { connected: true, items: [{ ...automatic, installation: "automatic", added: false }, { ...offered, installation: "optional", added: false }] });
  const teamView = <HubDownloadSection legalworkClient={client} workspaceId="test" kind="skill" readSkill={unused} />;
  const html = renderToStaticMarkup(<QueryClientProvider client={queries}><IntegrationLibraryLayoutContext.Provider value={{ actions: null, search: null, source }}><IntegrationLibrarySearchContext.Provider value={{ query, hasOtherResults: false }}>
    {query ? teamView : <SkillsView workspaceName="Test" busy={false} showHeader={false} canInstallSkillCreator canUseDesktopTools extensions={{ ...extensions, skills: () => [...skills, { name: automatic.name, path: "/team/research", firm: "automatic" }] }} onOpenLink={noop} createSessionAndOpen={noop} firmDownloadView={teamView} />}
  </IntegrationLibrarySearchContext.Provider></IntegrationLibraryLayoutContext.Provider></QueryClientProvider>);
  queries.clear();
  return html;
}

test("skills source tabs include the full team catalogue once, with optional skills beside installed ones", () => {
  const all = renderSkillSources("all");
  expect(all).toContain("skill-13");
  expect(all).toContain("DOCX Redline");
  expect(all.match(/>Team Research</g)).toHaveLength(1);
  expect(all).toContain("Offered Review");
  const personal = renderSkillSources("personal");
  expect(personal).toContain("skill-13");
  expect(personal).not.toContain("Team Research");
  expect(personal).not.toContain("Offered Review");
  expect(personal).not.toContain("DOCX Redline");
  const team = renderSkillSources("team");
  expect(team).toContain("Team Research");
  expect(team).toContain("Offered Review");
  expect(team).not.toContain("skill-13");
  expect(team).not.toContain("DOCX Redline");
  expect(team).not.toContain("Installed for everyone</");
});

test("embedded team skills use the library search and show an empty result rather than a second browser", () => {
  const match = renderSkillSources("team", "optional");
  expect(match).toContain("Offered Review");
  expect(match).not.toContain("Team Research");
  expect(renderSkillSources("team", "no-match")).toContain("No matching skills");
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

test("the storage source tabs include optional team sources and isolate personal and team entries", () => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const local = { ...storageInputSchema.parse({ name: "Personal files", config: { kind: "webdav", endpoint: "https://example.invalid/files" } }), id: "local", updatedAt: 1, configuredSecrets: [] };
  const shared = { ...local, id: "shared", name: "Team documents", teamInstallation: "optional", team: { orgId: "firm", version: 1, installed: false } };
  queries.setQueryData(["storage-connections", "test"], { connections: [local, shared] });
  queries.setQueryData(["storage-oauth-providers", "test"], { providers: [] });
  const html = renderToStaticMarkup(<QueryClientProvider client={queries}><IntegrationLibraryLayoutContext.Provider value={{ actions: null, search: null }}><HubScopeContext.Provider value="local"><FileStorageView client={createLegalworkServerClient({ baseUrl: "https://example.invalid" })} workspaceId="test" /></HubScopeContext.Provider></IntegrationLibraryLayoutContext.Provider></QueryClientProvider>);
  expect(html).toContain("Personal files");
  expect(html).toContain("Team documents");
  expect(html).toContain(">Team<");
  expect(html).toContain('aria-label="Actions for Personal files"');
  expect(html).toContain('aria-label="Actions for Team documents"');
  expect(html).not.toContain('aria-label="Edit Personal files"');
  expect(html).not.toContain('aria-label="Edit Team documents"');
  expect(html).not.toContain('aria-label="Disconnect Team documents"');
  for (const source of ["personal", "team"]) {
    const filtered = renderToStaticMarkup(<QueryClientProvider client={queries}><IntegrationLibraryLayoutContext.Provider value={{ actions: null, search: null, source: source === "team" ? "team" : "personal" }}><HubScopeContext.Provider value="local"><FileStorageView client={createLegalworkServerClient({ baseUrl: "https://example.invalid" })} workspaceId="test" /></HubScopeContext.Provider></IntegrationLibraryLayoutContext.Provider></QueryClientProvider>);
    expect(filtered).toContain(source === "team" ? "Team documents" : "Personal files");
    expect(filtered).not.toContain(source === "team" ? "Personal files" : "Team documents");
  }
  queries.clear();
});
