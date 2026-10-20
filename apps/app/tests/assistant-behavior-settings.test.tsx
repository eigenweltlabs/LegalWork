/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantBehaviorForm } from "../src/react-app/domains/settings/pages/assistant-behavior-settings";
import type { AssistantSettings, AssistantSettingsCatalog } from "@legalwork/types/main-assistant";

const settings: AssistantSettings = { systemPromptAddition: "Reply in German.", resourceIds: ["skill"], projectAccess: { mode: "include", projectIds: ["allowed"] } };
const catalog: AssistantSettingsCatalog = { projects: [{ id: "allowed", name: "Allowed matter" }, { id: "private", name: "Private matter" }], unavailable: [], resources: [
  { id: "skill", kind: "skill", name: "Evidence research", description: "Search evidence carefully.", reference: "/research/SKILL.md", projectId: null, projectName: null },
  { id: "workflow", kind: "workflow", name: "Prepare report", description: "Prepare a report.", reference: "/report/SKILL.md", projectId: "private", projectName: "Private matter" },
] };
test("Assistant settings render instructions, resource groups and the selected project's access clearly", () => {
  const html = renderToStaticMarkup(<AssistantBehaviorForm settings={settings} catalog={catalog} onSave={async value => value} />);
  for (const text of ["Reply in German.", "Plugins", "Workflows", "Skills", "Evidence research", "Search evidence carefully.", "Allowed matter", "Private matter"]) expect(html).toContain(text);
  expect(html).toContain("Available after you allow access to this project.");
  expect(html).not.toContain("/research/SKILL.md");
  expect(html).toContain("subagents or project sessions");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
test("unavailable selections remain visible and removable instead of silently granting access or losing settings", () => {
  const html = renderToStaticMarkup(<AssistantBehaviorForm settings={{ ...settings, resourceIds: ["removed"], projectAccess: { mode: "include", projectIds: ["removed"] } }} catalog={catalog} onSave={async value => value} />);
  expect(html).toContain("Selected resource unavailable");
  expect(html).toContain("Selected project unavailable");
});
