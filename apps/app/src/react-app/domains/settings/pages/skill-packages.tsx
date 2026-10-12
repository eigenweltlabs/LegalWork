import { IntegrationLibraryRow, IntegrationGroupHeading, IntegrationEmptyState } from "./integration-library";
/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Blocks, Loader2, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { t } from "@/i18n";
import { toast } from "@/components/ui/sonner";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import type { ImportedPlugin } from "../../../../app/lib/extension-imports";
import { BUILT_IN_SKILLS } from "../built-in-skills";
import { pluginImportName } from "./plugin-import-presentation";

/**
 * Two parts of the Skills tab: the packages imported into this workspace (a
 * package brings skills, connectors and commands at once; each part also shows
 * in its own list) and the skills built into LegalWork.
 */

export type SkillPackagesStore = {
  importedPackages: () => Promise<ImportedPlugin[]>;
  removeImportedPackage: (pluginId: string) => Promise<void>;
};

const PART_COPY = {
  skill: "skills.package_skills",
  mcp: "skills.package_connectors",
  command: "skills.package_commands",
  agent: "skills.package_agents",
} as const;

/** What a package brings, from the type of each of its parts, in words: "2 skills · 1 connector". */
export function packageParts(types: readonly string[]): string {
  return (["skill", "mcp", "command", "agent"] as const)
    .map((type) => ({ type, count: types.filter((each) => each === type).length }))
    .filter(({ count }) => count > 0)
    .map(({ type, count }) => t(PART_COPY[type], { count }))
    .join(" · ");
}

export function ImportedPackages(props: {
  extensions: SkillPackagesStore;
  busy: boolean;
  /** Changes when a package was imported, so the list is read again. */
  revision: number;
  searchQuery?: string;
  showEmpty?: boolean;
}) {
  const { extensions } = props;
  const [packages, setPackages] = useState<ImportedPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ImportedPlugin | null>(null);
  const [removing, setRemoving] = useState<ImportedPlugin | null>(null);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError("");
    extensions.importedPackages()
      .then((list) => {
        if (!stopped) setPackages(list);
      })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : t("skills.unknown_error")); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => {
      stopped = true;
    };
  }, [extensions, props.revision]);

  async function remove(plugin: ImportedPlugin) {
    try {
      await extensions.removeImportedPackage(plugin.pluginId);
      setPackages((list) => list.filter((each) => each.pluginId !== plugin.pluginId));
      toast.success(t("skills.package_removed", { name: pluginImportName(plugin) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("skills.unknown_error"));
    }
  }

  const query = props.searchQuery?.trim().toLowerCase() ?? "";
  const visiblePackages = packages.filter(plugin => !query || [pluginImportName(plugin), plugin.description ?? "", packageParts(plugin.files.map(file => file.objectType))].join(" ").toLowerCase().includes(query));
  if (loading) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("common.loading")}</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (visiblePackages.length === 0 && !props.showEmpty) return null;
  return (
    <div className="space-y-4">
      <IntegrationGroupHeading hideInLibrary title={t("skills.packages_title")} count={visiblePackages.length} />
      {visiblePackages.length === 0 ? <IntegrationEmptyState icon={Package} title={t("integrations.no_packages")} description={t(query ? "integrations.search_hint" : "integrations.import_description")} /> : null}
      <div className="space-y-1">
        {visiblePackages.map((plugin) => (
          <IntegrationLibraryRow key={plugin.pluginId} name={pluginImportName(plugin)} description={plugin.description || packageParts(plugin.files.map(file => file.objectType))}
            icon={<span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border"><Package className="size-4 text-muted-foreground" /></span>} busy={props.busy} onOpen={() => setSelected(plugin)}
            onRemove={() => setRemoving(plugin)} />
        ))}
      </div>
      <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selected ? pluginImportName(selected) : ""}</DialogTitle><DialogDescription>{selected?.description || t("integrations.import_description")}</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">{selected ? packageParts(selected.files.map(file => file.objectType)) : ""}</p>
          <DialogFooter><Button onClick={() => setSelected(null)}>{t("common.close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={removing !== null}
        title={t("skills.package_remove_title", { name: removing ? pluginImportName(removing) : "" })}
        message={t(removing?.scope === "global" ? "extensions.import_remove_global" : "skills.package_remove_message")}
        confirmLabel={t("skills.package_remove")}
        cancelLabel={t("common.cancel")}
        confirmButtonVariant="destructive"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void remove(target);
        }}
      />
    </div>
  );
}

export function matchingBuiltInSkills(searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  return BUILT_IN_SKILLS.filter(skill => !query || [skill.name, skill.description(), ...skill.commands].join(" ").toLowerCase().includes(query));
}

export function BuiltInSkills(props: { searchQuery?: string; showEmpty?: boolean } = {}) {
  const skills = matchingBuiltInSkills(props.searchQuery);
  const [selected, setSelected] = useState<typeof skills[number] | null>(null);
  if (skills.length === 0 && !props.showEmpty) return null;
  return (
    <div className="space-y-4">
      <IntegrationGroupHeading hideInLibrary title={t("skills.built_in_title")} count={skills.length} />
      {skills.length === 0 ? <IntegrationEmptyState icon={Blocks} title={t("integrations.no_skill_matches")} description={t("integrations.search_hint")} /> : null}
      <div className="space-y-1">
        {skills.map((skill) => (
          <IntegrationLibraryRow key={skill.id} name={skill.name} description={skill.description()} source={t("integrations.included")} onOpen={() => setSelected(skill)}
            icon={<span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border"><Blocks className="size-4 text-muted-foreground" /></span>} />
        ))}
      </div>
      <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?.description()}</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("integrations.skill_commands")}</p>
          <div className="flex flex-wrap gap-2">{selected?.commands.map(command => <code key={command} className="rounded-md bg-muted px-2 py-1 text-sm">{command}</code>)}</div>
          <DialogFooter><Button onClick={() => setSelected(null)}>{t("common.close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
