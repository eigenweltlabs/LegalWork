import { PluginImportDialog, type PluginImportStore } from "./plugin-import-dialog";
/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Blocks, Download, FolderOpen, HardDrive, ListFilter, Package, Plug } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

import { PluginsView, type PluginsExtensionsStore } from "./plugins-view";
import { HubScopeContext } from "./hub-scope-context";
import { HubTabs, type HubTab } from "../segmented-tabs";
import { IntegrationAddMenu, IntegrationLibraryLayoutContext, IntegrationMoreMenu, type IntegrationAddRequest, type IntegrationLibraryKind, type IntegrationLibrarySource } from "./integration-library";
import { ImportSkillsButton, type SkillImportSource, type SkillImportStore, type SkillsExtensionsStore } from "./skills-view";
import { orgPolicyAllows, useOrgPolicyForbids } from "../../connections/org-policy";
import { ImportedPackages } from "./skill-packages";

export type ExtensionsSection = "all" | "mcp" | "skills" | "plugins" | "storage";

type ExtensionsTab = "connectors" | "skills" | "plugins" | "storage";

type SuggestedPlugin = {
  name: string;
  packageName: string;
  description: string;
  tags: string[];
  aliases?: string[];
  installMode?: "simple" | "guided";
  steps?: Array<{
    title: string;
    description: string;
    command?: string;
    url?: string;
    path?: string;
    note?: string;
  }>;
};

export type ExtensionsViewProps = {
  busy: boolean;
  /** Engine plugins are code for developers: their tab shows only in developer mode. */
  developerMode: boolean;
  selectedWorkspaceRoot: string;
  isRemoteWorkspace: boolean;
  canEditPlugins: boolean;
  canUseGlobalScope: boolean;
  accessHint?: string | null;
  suggestedPlugins: SuggestedPlugin[];
  extensions: PluginsExtensionsStore;
  pluginImports?: PluginImportStore;
  skillImports?: SkillImportStore & Pick<SkillsExtensionsStore, "skills">;
  skillTools?: Pick<SkillsExtensionsStore, "importedPackages" | "removeImportedPackage" | "revealSkillsFolder">;
  canImportSkills?: boolean;
  canAddConnector?: boolean;
  canAddSkill?: boolean;
  canAddStorage?: boolean;
  mcpConnectedAppsCount: number;
  /** Connectors tab — the MCP quick-connect grid + configured servers + built-ins. */
  mcpView: ReactNode;
  storageView?: ReactNode;
  /** Skills tab — built-in, installed and imported skills, with add/import. */
  skillsView: ReactNode;
  onRefresh: () => void;
  initialSection?: ExtensionsSection;
  setSectionRoute?: (tab: "mcp" | "skills" | "plugins" | "storage") => void;
  showHeader?: boolean;
};

// The Integrations page covers connectors (MCP), file storage and skills; in
// developer mode also the engine's plugins (code it loads).
// Built per render, not once at import: `t()` reads the current language, so a
// module-level constant would freeze the tabs in whatever language loaded first.
const tabs = (developerMode: boolean): HubTab<ExtensionsTab>[] => {
  const items: HubTab<ExtensionsTab>[] = [
    { id: "connectors", label: t("extensions.connectors_label") },
    { id: "skills", label: "Skills" },
    { id: "storage", label: t("storage.tab") },
  ];
  if (developerMode) items.push({ id: "plugins", label: t("extensions.engine_plugins") });
  return items;
};

export function ExtensionsView(props: ExtensionsViewProps) {
  // An old link to the Plugins tab opens Skills, where the built-in ones are now.
  const initialTab: ExtensionsTab =
    props.initialSection === "storage" ? "storage" : props.initialSection === "plugins"
      ? props.developerMode ? "plugins" : "skills"
      : props.initialSection === "skills"
        ? "skills"
        : "connectors";
  const [importOpen, setImportOpen] = useState(false);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [skillImportSource, setSkillImportSource] = useState<SkillImportSource>("files");
  const importButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [importVersion, setImportVersion] = useState(0);
  const [tab, setTab] = useState<ExtensionsTab>(initialTab);
  const [source, setSource] = useState<IntegrationLibrarySource>("all");
  const [addRequest, setAddRequest] = useState<IntegrationAddRequest | null>(null);
  const addSequence = useRef(0);
  const onAddHandled = useCallback(() => setAddRequest(null), []);
  const connectorsForbidden = useOrgPolicyForbids("connectors.allowCustom");
  const skillsForbidden = useOrgPolicyForbids("skills.allowCustom");
  const storageForbidden = useOrgPolicyForbids("storage.allowPersonal");
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const [leadingActionsTarget, setLeadingActionsTarget] = useState<HTMLElement | null>(null);
  const [searchTarget, setSearchTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTab(initialTab), [initialTab]);
  const selectTab = (next: ExtensionsTab) => {
    setTab(next);
    props.setSectionRoute?.(next === "connectors" ? "mcp" : next);
  };

  const TABS = tabs(props.developerMode);
  const canImportPlugins = props.canEditPlugins && props.canUseGlobalScope;
  const canImportSkills = Boolean(props.skillImports && props.canImportSkills);
  const refresh = () => { setImportVersion(value => value + 1); props.onRefresh(); };
  const importedSkills = () => { setSource("all"); selectTab("skills"); refresh(); };
  const requestAdd = (kind: IntegrationLibraryKind) => {
    setSource("all");
    selectTab(kind === "connector" ? "connectors" : kind === "skill" ? "skills" : "storage");
    setAddRequest({ kind, id: ++addSequence.current });
  };

  return (
    <IntegrationLibraryLayoutContext.Provider value={{ actions: actionsTarget, search: searchTarget, leadingActions: leadingActionsTarget, onRefresh: refresh, revision: importVersion, source, addRequest, onAddHandled, ownsMoreMenu: true }}>
      <section className="w-full min-w-0 max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={props.showHeader === false ? "sr-only" : "text-xl font-medium tracking-tight"}>{t("extensions.eyebrow_integrations")}</h2>
            {props.showHeader !== false ? <p className="mt-1 text-[13px] text-muted-foreground">{t("integrations.description")}</p> : null}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <div ref={setLeadingActionsTarget} className="flex items-center gap-2 empty:hidden" />
            {props.pluginImports ? <Button ref={importButton} variant="outline" size="sm" disabled={props.busy || (!canImportPlugins && !canImportSkills)} onClick={() => setImportOpen(true)}><Download className="size-3.5" />{t("integrations.import_action")}</Button> : null}
            <IntegrationAddMenu disabled={props.busy} actions={[
              { label: t("integrations.connector"), icon: Plug, disabled: props.canAddConnector === false || connectorsForbidden, onClick: () => requestAdd("connector") },
              { label: t("skills.eyebrow_skill"), icon: Blocks, disabled: props.canAddSkill === false || skillsForbidden, onClick: () => requestAdd("skill") },
              { label: t("storage.tab"), icon: HardDrive, disabled: props.canAddStorage === false || !props.storageView || storageForbidden, onClick: () => requestAdd("storage") },
            ]} />
            <div ref={setActionsTarget} className="flex items-center gap-2 empty:hidden" />
            <IntegrationMoreMenu pageToolbar triggerRef={moreButton} busy={props.busy}>
              <DropdownMenuItem disabled={props.busy || !props.skillTools} onClick={() => setPackagesOpen(true)}><Package />{t("skills.packages_title")}</DropdownMenuItem>
              <DropdownMenuItem disabled={props.busy || props.isRemoteWorkspace || !props.skillTools} onClick={async () => {
                if (props.busy || props.isRemoteWorkspace || !props.skillTools) return;
                try { await props.skillTools.revealSkillsFolder(); }
                catch (error) { toast.error(error instanceof Error ? error.message : t("skills.unknown_error")); }
              }}><FolderOpen />{t("skills.reveal_folder")}</DropdownMenuItem>
            </IntegrationMoreMenu>
          </div>
        </div>
        {packagesOpen && props.skillTools ? <Dialog open onOpenChange={setPackagesOpen}>
          <DialogContent finalFocus={moreButton} className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>{t("skills.packages_title")}</DialogTitle><DialogDescription>{t("skills.packages_desc")}</DialogDescription></DialogHeader>
            <ImportedPackages extensions={props.skillTools} busy={props.busy} revision={importVersion} showEmpty />
          </DialogContent>
        </Dialog> : null}
        {importOpen && props.pluginImports ? <PluginImportDialog store={props.pluginImports} onClose={() => setImportOpen(false)} onImported={preview => { setImportVersion(value => value + 1); setSource("all"); selectTab(preview.format === "connectors" ? "connectors" : "skills"); props.onRefresh(); }}
          returnFocus={importButton}
          canImportPlugins={canImportPlugins && !props.busy}
          canImportSkills={canImportSkills && !props.busy}
          canImportLocalSkills={canImportSkills && !props.busy && !props.isRemoteWorkspace}
          onImportSkills={props.skillImports ? async importSource => {
            if (!props.canImportSkills || props.busy || (importSource === "files" && props.isRemoteWorkspace) || !(await orgPolicyAllows("skills.allowCustom"))) return;
            setImportOpen(false);
            setSource("all");
            selectTab("skills");
            setSkillImportSource(importSource);
            setSkillImportOpen(true);
          } : undefined} /> : null}
        {props.skillImports ? <ImportSkillsButton open={skillImportOpen} onOpenChange={setSkillImportOpen} source={skillImportSource} returnFocus={importOpen ? false : importButton} asWorkflow={false} busy={props.busy} canUseDesktopTools={!props.isRemoteWorkspace} existingNames={new Set(props.skillImports.skills().map(skill => skill.name))} extensions={props.skillImports} onImported={importedSkills} onPackageImported={importedSkills} onBack={() => { setSkillImportOpen(false); setImportOpen(true); }} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HubTabs items={TABS} value={tab} onChange={selectTab} label={t("extensions.eyebrow_integrations")} />
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div ref={setSearchTarget} className="min-w-0 flex-1 empty:hidden sm:flex-none" />
            {tab !== "plugins" ? <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" title={t("integrations.filter_source")} />}>
                <ListFilter className="size-3.5" />{source === "all" ? t("integrations.filter") : source === "personal" ? t("integrations.source_personal") : t("firm_hub.scope_team")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup aria-label={t("integrations.filter_source")} value={source} onValueChange={value => { if (value === "all" || value === "personal" || value === "team") setSource(value); }}>
                  <DropdownMenuRadioItem value="all" closeOnClick>{t("integrations.all_sources")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="personal" closeOnClick>{t("integrations.source_personal")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="team" closeOnClick>{t("firm_hub.scope_team")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu> : null}
          </div>
        </div>

        <HubScopeContext.Provider value="local">
          {tab === "connectors" ? props.mcpView : null}

          {tab === "storage" ? props.storageView : null}

          {tab === "skills" ? props.skillsView : null}

          {tab === "plugins" ? (
            <PluginsView
              extensions={props.extensions}
              busy={props.busy}
              selectedWorkspaceRoot={props.selectedWorkspaceRoot}
              canEditPlugins={props.canEditPlugins}
              canUseGlobalScope={props.canUseGlobalScope}
              accessHint={props.accessHint}
              suggestedPlugins={props.suggestedPlugins}
            />
          ) : null}
        </HubScopeContext.Provider>
      </section>
    </IntegrationLibraryLayoutContext.Provider>
  );
}
