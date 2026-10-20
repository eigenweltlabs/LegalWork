/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantResourceOptions } from "../src/react-app/domains/settings/pages/assistant-resource-picker";
import { AssistantBehaviorForm } from "../src/react-app/domains/settings/pages/assistant-behavior-settings";
import type { AssistantSettings, AssistantSettingsCatalog } from "@legalwork/types/main-assistant";

const settings: AssistantSettings = { systemPromptAddition: "Reply in German.", resourceIds: ["skill"], projectAccess: { mode: "include", projectIds: ["allowed"] } };
const catalog: AssistantSettingsCatalog = { projects: [{ id: "allowed", name: "Allowed matter" }, { id: "private", name: "Private matter" }], unavailable: [], resources: [
  { id: "skill", kind: "skill", name: "Evidence research", description: "Search evidence carefully.", reference: "/research/SKILL.md", projectId: null, projectName: null },
  { id: "workflow", kind: "workflow", name: "Prepare report", description: "Prepare a report.", reference: "/report/SKILL.md", projectId: "private", projectName: "Private matter" },
] };
test("Assistant settings show compact resource rows and removable selections without mounting the library", () => {
  const html = renderToStaticMarkup(<AssistantBehaviorForm settings={settings} catalog={catalog} onSave={async value => value} />);
  for (const text of ["Reply in German.", "Plugins", "Workflows", "Skills", "Evidence research", "Allowed matter", "Private matter"]) expect(html).toContain(text);
  for (const label of ["Add: Plugins", "Add: Workflows", "Add: Skills", "Remove: Evidence research"]) expect(html).toContain(label);
  expect(html).not.toContain("Search evidence carefully.");
  expect(html).not.toContain("Prepare report");
  expect(html).not.toContain("<details");
  expect(html).not.toContain("/research/SKILL.md");
  expect(html).toContain("preferred resources");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
test("the resource picker shows descriptions and project restrictions when opened", () => {
  const html = renderToStaticMarkup(<AssistantResourceOptions resources={catalog.resources} selectedIds={settings.resourceIds} projectAllowed={id => id !== "private"} onToggle={() => {}} />);
  expect(html).toContain("Search evidence carefully.");
  expect(html).toContain("Prepare report");
  expect(html).toContain("Available after you allow access to this project.");
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('aria-checked="false"');
  expect(html).not.toContain("/research/SKILL.md");
});
test("unavailable selections remain visible and removable instead of silently granting access or losing settings", () => {
  const html = renderToStaticMarkup(<AssistantBehaviorForm settings={{ ...settings, resourceIds: ["removed"], projectAccess: { mode: "include", projectIds: ["removed"] } }} catalog={catalog} onSave={async value => value} />);
  expect(html).toContain("Selected resource unavailable");
  expect(html).toContain("Selected project unavailable");
});
