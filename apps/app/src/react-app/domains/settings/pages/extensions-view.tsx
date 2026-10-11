import { PluginImportDialog, type PluginImportStore } from "./plugin-import-dialog";
/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from "react";
import { Blocks, Cpu, Download, HardDrive, Plug, RefreshCw, type LucideIcon } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/react-app/design-system/surface";

import { PluginsView, type PluginsExtensionsStore } from "./plugins-view";
import { HubScopeContext, HubScopeToggle, type HubScope } from "./hub-scope-context";

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
  mcpConnectedAppsCount: number;
  /** Connectors tab — the MCP quick-connect grid + configured servers + built-ins. */
  mcpView: ReactNode;
  /** Connectors tab, Local: the firm's connectors on this computer, with sign-in and own keys. */
  firmConnectorsView?: ReactNode;
  storageView?: ReactNode;
  /** Skills tab — built-in, installed and imported skills, with add/import. */
  skillsView: ReactNode;
  /** Whether the firm is connected + entitled (shows the Local/Team toggle). */
  hasTeamHub?: boolean;
  /** Opens the multi-select "Share with your firm" dialog. */
  onOpenTeamShare?: () => void;
  onRefresh: () => void;
  initialSection?: ExtensionsSection;
  setSectionRoute?: (tab: "mcp" | "skills" | "plugins" | "storage") => void;
  showHeader?: boolean;
};

// The Integrations page covers connectors (MCP), file storage and skills; in
// developer mode also the engine's plugins (code it loads).
// Built per render, not once at import: `t()` reads the current language, so a
// module-level constant would freeze the tabs in whatever language loaded first.
const tabs = (developerMode: boolean): Array<{ id: ExtensionsTab; label: string; icon: LucideIcon; subtitle: string }> => [
  { id: "connectors", label: t("extensions.connectors_label"), icon: Plug, subtitle: t("extensions.apps_subtitle_short") },
  { id: "skills", label: "Skills", icon: Blocks, subtitle: t("extensions.skills_subtitle") },
  { id: "storage", label: t("storage.tab"), icon: HardDrive, subtitle: t("storage.intro") },
  ...(developerMode ? [{ id: "plugins" as const, label: t("extensions.engine_plugins"), icon: Cpu, subtitle: t("extensions.engine_plugins_subtitle") }] : []),
];


export function ExtensionsView(props: ExtensionsViewProps) {
  // An old link to the Plugins tab opens Skills, where the built-in ones are now.
  const initialTab: ExtensionsTab =
    props.initialSection === "storage" ? "storage" : props.initialSection === "plugins"
      ? props.developerMode ? "plugins" : "skills"
      : props.initialSection === "skills"
        ? "skills"
        : "connectors";
  const [importOpen, setImportOpen] = useState(false);
  const [importVersion, setImportVersion] = useState(0);
  const [tab, setTab] = useState<ExtensionsTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  // Local | Team is the OUTER toggle for the whole Integrations page; the
  // Connectors/Skills tabs sit inside it. The sub-views follow this scope via
  // HubScopeContext. The firm hands out no engine plugins: that tab is local.
  const [selectedScope, setHubScope] = useState<HubScope>("local");
  const teamHub = props.hasTeamHub === true && tab !== "plugins";
  const hubScope = teamHub || tab === "storage" ? selectedScope : "local";

  const selectTab = (next: ExtensionsTab) => {
    setTab(next);
    props.setSectionRoute?.(next === "connectors" ? "mcp" : next);
  };

  const TABS = tabs(props.developerMode);

  return (
    <section className="w-full min-w-0 max-w-5xl space-y-6">
      {props.showHeader !== false ? <SectionHeading size="page" title={t("extensions.eyebrow_integrations")} description={t("integrations.description")} action={
        <Button variant="ghost" size="icon-sm" disabled={props.busy} aria-label={t("common.refresh")} title={t("common.refresh")} onClick={() => { setImportVersion(value => value + 1); props.onRefresh(); }}><RefreshCw /></Button>
      } /> : null}
      {importOpen && props.pluginImports ? <PluginImportDialog store={props.pluginImports} onClose={() => setImportOpen(false)} onImported={preview => { setImportVersion(value => value + 1); selectTab(preview.format === "connectors" ? "connectors" : "skills"); props.onRefresh(); }} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border">
        <div role="group" aria-label={t("extensions.eyebrow_integrations")} className="flex flex-wrap gap-5">
          {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => selectTab(id)} className={`inline-flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" />{label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          {hubScope === "local" && tab !== "storage" && props.pluginImports ? <Button variant="outline" size="sm" disabled={props.busy || !props.canEditPlugins || !props.canUseGlobalScope} onClick={() => setImportOpen(true)}><Download className="size-4" />{t("integrations.import_action")}</Button> : null}
          {teamHub || tab === "storage" ? <HubScopeToggle scope={hubScope} onChange={setHubScope} /> : null}
          {hubScope === "team" && tab !== "storage" && props.onOpenTeamShare ? <Button size="sm" variant="outline" onClick={props.onOpenTeamShare}>{t("extensions.share_with_firm")}</Button> : null}
          {props.showHeader === false ? <Button variant="ghost" size="icon-sm" disabled={props.busy} aria-label={t("common.refresh")} title={t("common.refresh")} onClick={() => { setImportVersion(value => value + 1); props.onRefresh(); }}><RefreshCw /></Button> : null}
        </div>
      </div>

      <HubScopeContext.Provider key={importVersion} value={hubScope}>
      {tab === "connectors" ? (
        <div className="space-y-8">
          {props.mcpView}
          {hubScope === "local" ? props.firmConnectorsView : null}
        </div>
      ) : null}

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
  );
}
