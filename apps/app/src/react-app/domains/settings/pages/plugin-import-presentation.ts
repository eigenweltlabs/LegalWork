import type { PluginImportCandidate } from "@legalwork/types/plugin-import";
import { t } from "@/i18n";

export function pluginImportName(plugin: { name: string; displayName?: string }): string {
  if (plugin.displayName) return plugin.displayName;
  if (/^app-[a-f0-9]{16,}$/i.test(plugin.name)) return t("extensions.import_unnamed");
  return plugin.name.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Imported skills keep their unique execution name; cards show the component name. */
export function pluginImportSkillName(skill: { name: string; path: string }): string {
  const owner = skill.path.replace(/\\/g, "/").match(/\/skills\/[^/]+-([a-f0-9]{8})-plugin\/[^/]+(?:\/SKILL\.md)?\/?$/i);
  if (!owner) return skill.name;
  const prefix = skill.name.match(new RegExp(`^[a-z0-9-]+-${owner[1]}-(.+)$`));
  return prefix ? pluginImportName({ name: prefix[1] }) : skill.name;
}

/** One row per plugin; keep other copies available in the source details. */
export function groupPluginImportCandidates(candidates: PluginImportCandidate[]) {
  const groups = new Map<string, PluginImportCandidate[]>();
  for (const candidate of candidates) {
    const copies = groups.get(candidate.name) ?? [];
    copies.push(candidate);
    groups.set(candidate.name, copies);
  }
  return [...groups.values()].flatMap(sources => {
    sources.sort((a, b) => (b.version ?? "").localeCompare(a.version ?? "", undefined, { numeric: true }) || Number(b.path.includes("/cache/")) - Number(a.path.includes("/cache/")) || a.path.localeCompare(b.path));
    return sources[0] ? [{ candidate: sources[0], sources }] : [];
  }).sort((a, b) => pluginImportName(a.candidate).localeCompare(pluginImportName(b.candidate)));
}
