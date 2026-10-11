import { PluginImportDialog, type PluginImportStore } from "./plugin-import-dialog";
/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from "react";
import { Download, RefreshCw, Share2 } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";

import { PluginsView, type PluginsExtensionsStore } from "./plugins-view";
import { HubScopeContext } from "./hub-scope-context";
import { HubTabs, type HubTab } from "../segmented-tabs";
import { IntegrationLibraryLayoutContext } from "./integration-library";

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
  storageView?: ReactNode;
  /** Skills tab — built-in, installed and imported skills, with add/import. */
  skillsView: ReactNode;
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
  const [importVersion, setImportVersion] = useState(0);
  const [tab, setTab] = useState<ExtensionsTab>(initialTab);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const [searchTarget, setSearchTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTab(initialTab), [initialTab]);
  const selectTab = (next: ExtensionsTab) => {
    setTab(next);
    props.setSectionRoute?.(next === "connectors" ? "mcp" : next);
  };

  const TABS = tabs(props.developerMode);

  return (
    <IntegrationLibraryLayoutContext.Provider value={{ actions: actionsTarget, search: searchTarget }}>
      <section className="w-full min-w-0 max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={props.showHeader === false ? "sr-only" : "text-xl font-medium tracking-tight"}>{t("extensions.eyebrow_integrations")}</h2>
            {props.showHeader !== false ? <p className="mt-1 text-[13px] text-muted-foreground">{t("integrations.description")}</p> : null}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <div ref={setActionsTarget} className="flex flex-wrap items-center gap-2 empty:hidden" />
            {tab !== "storage" && props.pluginImports ? <Button variant="outline" size="sm" disabled={props.busy || !props.canEditPlugins || !props.canUseGlobalScope} onClick={() => setImportOpen(true)}><Download className="size-3.5" />{t("integrations.import_action")}</Button> : null}
            {tab !== "storage" && props.onOpenTeamShare ? <Button size="icon-sm" variant="ghost" onClick={props.onOpenTeamShare} aria-label={t("extensions.share_with_firm")} title={t("extensions.share_with_firm")}><Share2 className="size-3.5" /></Button> : null}
            <Button variant="ghost" size="icon-sm" disabled={props.busy} aria-label={t("common.refresh")} title={t("common.refresh")} onClick={() => { setImportVersion(value => value + 1); props.onRefresh(); }}><RefreshCw className="size-3.5" /></Button>
          </div>
        </div>
        {importOpen && props.pluginImports ? <PluginImportDialog store={props.pluginImports} onClose={() => setImportOpen(false)} onImported={preview => { setImportVersion(value => value + 1); selectTab(preview.format === "connectors" ? "connectors" : "skills"); props.onRefresh(); }} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HubTabs items={TABS} value={tab} onChange={selectTab} label={t("extensions.eyebrow_integrations")} />
          <div ref={setSearchTarget} className="w-full empty:hidden sm:w-64" />
        </div>

        <HubScopeContext.Provider key={importVersion} value="local">
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
