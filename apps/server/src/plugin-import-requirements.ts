import { satisfies, valid, validRange } from "semver";
import type { PluginImportPreview, PluginImportRequirement } from "@legalwork/types/plugin-import";
import type { CloudImportedPlugin } from "./cloud-plugins.js";

export function pluginRequirements(manifest: Record<string, unknown>): PluginImportRequirement[] {
  const result: PluginImportRequirement[] = [];
  if (manifest.dependencies !== undefined) {
    const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [manifest.dependencies];
    for (const dependency of dependencies) {
      const object = dependency && typeof dependency === "object" && !Array.isArray(dependency) ? dependency : {};
      const name = typeof dependency === "string" ? dependency : "name" in object && typeof object.name === "string" ? object.name : "Unknown dependency";
      const version = "version" in object && typeof object.version === "string" ? object.version : undefined;
      const marketplace = "marketplace" in object && typeof object.marketplace === "string" ? object.marketplace : name.includes("@") ? name.split("@")[1] : undefined;
      result.push({ kind: "dependency", name: name.split("@")[0], ...(version ? { version } : {}), ...(marketplace ? { marketplace } : {}), code: "plugin_dependency", status: "blocked", required: true, message: `This plugin requires ${name}${version ? ` (${version})` : ""}. Install a compatible copy from the same trusted source before importing.` });
    }
  }
  return result;
}

export function evaluateImportRequirements(preview: PluginImportPreview, installed: CloudImportedPlugin[] = []): void {
  const requirements = (preview.requirements ?? []).map((requirement): PluginImportRequirement => {
    if (requirement.kind !== "dependency") return requirement;
    const matches = installed.filter(plugin => plugin.name === requirement.name && plugin.pluginId !== preview.id && (!requirement.marketplace || plugin.marketplaceId === requirement.marketplace) && (!requirement.version || Boolean(valid(plugin.provenance?.version) && validRange(requirement.version) && satisfies(plugin.provenance?.version || "", requirement.version))));
    const match = matches.length === 1 ? matches[0] : undefined;
    const readiness = match?.importState?.readiness;
    if (!match || readiness === "unsupported" || readiness === "partial") return { ...requirement, status: "blocked" satisfies PluginImportRequirement["status"], message: `Install one unambiguous, compatible copy of ${requirement.name}${requirement.version ? ` (${requirement.version})` : ""}${requirement.marketplace ? ` from ${requirement.marketplace}` : ""} before importing. Its dependency requirements must also be met.` };
    return { ...requirement, status: readiness === "setup" ? "setup" : "satisfied" satisfies PluginImportRequirement["status"], message: readiness === "setup" ? `Finish setting up the installed dependency ${requirement.name} before using this plugin.` : `${requirement.name} is installed with a compatible version.` };
  });
  preview.requirements = requirements;
  const connectors = preview.connectors ?? [];
  preview.readiness = requirements.some(item => item.required && item.status === "blocked") || !preview.components.length ? "unsupported"
    : requirements.some(item => item.status === "changed" || item.status === "blocked") || connectors.some(item => item.status === "blocked") ? "partial"
    : requirements.some(item => item.status === "setup") || connectors.some(item => item.status !== "compatible") ? "setup" : "ready";
}
