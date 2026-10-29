import { cloneElement, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Download, FolderOpen, Globe, Grid2X2, MoreHorizontal, Plus, Plug, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { connectorDefinitions, connectorIsConnected } from "@legalwork/types/connectors";
import { legalResearchProviders, type ResearchProvider } from "@legalwork/types/legal-research";
import type { StorageConnection, StorageKind, StorageOAuthProvider } from "@legalwork/types/file-storage";
import type { FirmHubItem } from "@legalwork/types/firm-hub";
import type { LegalworkBrowserPassword } from "@/app/lib/legalwork-server";
import type { ImportedPlugin } from "@/app/lib/extension-imports";
import { isBuiltInLegalWorkExtension, type McpDirectoryInfo } from "@/app/constants";
import { getMcpIdentityKey } from "@/app/mcp";
import { evaluateEnablement } from "@/app/enablement";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { usePlatform } from "@/react-app/kernel/platform";
import { resolveBrandIconSrc } from "@/react-app/design-system/extension-icon-src";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { ConnectorConfig } from "../connector-config";
import { connectorStatusQuery } from "../connector-status-query";
import { CONNECTOR_SETTINGS_CHANGED } from "../connector-write-settings";
import { isLegalWorkExtensionEnabled, isLegalWorkExtensionHidden, LEGALWORK_EXTENSION_STATE_CHANGED, setLegalWorkExtensionEnabled } from "../extension-state";
import { useFirmHub } from "../../connections/firm-hub";
import { useOrgPolicyForbids, orgPolicyAllows } from "../../connections/org-policy";
import { AddMcpModal } from "../../connections/modals/add-mcp-modal";
import { McpConnectorSetupModal } from "../../connections/modals/mcp-connector-setup-modal";
import { IntegrationLibraryLayoutContext, IntegrationSearch } from "./integration-library";
import { ConnectorStatus, configuredConnectorState, type ConnectorState } from "./connector-status";
import { StorageConnectionDialog } from "./file-storage-view";
import { STORAGE_CHANGED_EVENT, storageKinds, storageLabel, storageDescription, storageIcons } from "./storage-providers";
import { StorageOAuthSignIn } from "./storage-oauth-signin";
import { ShareCloudStorageDialog } from "./share-cloud-storage-dialog";
import { PluginImportDialog } from "./plugin-import-dialog";
import { PluginDetailsDialog, type PluginDetailsAccess } from "./plugin-details-dialog";
import { pluginImportName, pluginImportConnectorName, importedConnectorPlugin } from "./plugin-import-presentation";
import { PluginsView } from "./plugins-view";
import { FirmConnectorRow, firmConnectorName } from "./firm-connectors";
import { ResearchConnectionDialog } from "./research-connection-dialog";
import { connectorCategories, connectorCategory, popularConnector, type ConnectorCategory } from "./connector-categories";
import type { ExtensionsViewProps } from "./extensions-view";

type Target =
  | { kind: "service"; entry: McpDirectoryInfo }
  | { kind: "native"; id: string }
  | { kind: "storage"; storageKind: StorageKind; provider?: StorageOAuthProvider; connection?: StorageConnection }
  | { kind: "research"; provider?: ResearchProvider; connection?: LegalworkBrowserPassword }
  | { kind: "package"; plugin: ImportedPlugin }
  | { kind: "server"; name: string }
  | { kind: "team"; item: FirmHubItem };
type Item = { id: string; name: string; description: string; category: ConnectorCategory; popular?: boolean; icon: ReactNode; target: Target; installed: boolean; status?: ConnectorState; team?: boolean };
type StorageEditor = { kind: StorageKind; provider?: StorageOAuthProvider; connection?: StorageConnection; account?: StorageConnection };
const cloudProvider = (provider: { id: string; name: string }): StorageOAuthProvider => ({ ...provider, rootHint: t(provider.id === "google-drive" ? "storage.google_root_hint" : "storage.microsoft_root_hint") });
const categoryLabel = (category: ConnectorCategory) => t(`catalog.category_${category}`);

type ConnectionMethod = "skill" | "mcp" | "api" | "website_automation";
function connectionMethods(target: Target): ConnectionMethod[] {
  if (target.kind === "research") return ["website_automation"];
  if (target.kind === "native" || target.kind === "storage") return ["api"];
  if (target.kind === "server" || target.kind === "team") return ["mcp"];
  const types = target.kind === "package"
    ? target.plugin.files.map(file => file.objectType)
    : target.entry.extensionManifest?.resources.map(resource => resource.type) ?? [target.entry.kind ?? "mcp"];
  const methods: ConnectionMethod[] = [];
  if (types.includes("skill")) methods.push("skill");
  if (types.includes("mcp")) methods.push("mcp");
  if (!methods.length && target.kind === "service" && target.entry.kind === "extension") methods.push("api");
  return methods;
}
function MethodTags({ target }: { target: Target }) {
  const methods = connectionMethods(target);
  return methods.length ? <span role="group" aria-label={t("catalog.how_it_works")} className="mt-2 flex flex-wrap gap-1.5">{methods.map(method => <span key={method} className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-normal leading-4 text-muted-foreground">{t(`catalog.method_${method}`)}</span>)}</span> : null;
}

function Brand({ name, slug, src }: { name: string; slug?: string; src?: string }) {
  const icon = resolveBrandIconSrc(src, slug);
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/50 bg-background">{icon ? <img src={icon} alt="" className="size-6 object-contain" /> : <span className="text-base font-semibold text-foreground/70">{name.slice(0, 1)}</span>}</span>;
}

export function ConnectorBrowser(props: ExtensionsViewProps) {
  const { client, storageWorkspaceId: workspaceId } = props;
  const mcp = props.mcpView.props;
  const cache = useQueryClient(), platform = usePlatform();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("connection");
  const [category, setCategory] = useState<ConnectorCategory | null>(props.initialSection === "storage" ? "files" : null);
  const [search, setSearch] = useState("");
  const [storageEditor, setStorageEditor] = useState<StorageEditor | null>(null);
  const [researchEditor, setResearchEditor] = useState<{ provider?: ResearchProvider; connection?: LegalworkBrowserPassword; template?: LegalworkBrowserPassword } | null>(null);
  const [sharing, setSharing] = useState<StorageConnection | null>(null);
  const [setup, setSetup] = useState<McpDirectoryInfo | null>(null);
  const [managedServer, setManagedServer] = useState<string | null>(null);
  const [managedPackage, setManagedPackage] = useState<ImportedPlugin | null>(null);
  const [remove, setRemove] = useState<Item | null>(null);
  const [removing, setRemoving] = useState(false);
  const [customOpen, setCustomOpen] = useState(false), [importOpen, setImportOpen] = useState(false), [engineOpen, setEngineOpen] = useState(false);
  const [, setVersion] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const storageForbidden = useOrgPolicyForbids("storage.allowPersonal");
  const connectorsForbidden = useOrgPolicyForbids("connectors.allowCustom");
  const pluginsForbidden = useOrgPolicyForbids("plugins.allowCustom");
  const accounts = useQuery(connectorStatusQuery(client));
  const team = useFirmHub(client);
  const storage = useQuery({ queryKey: ["storage-connections", workspaceId], queryFn: () => { if (!client || !workspaceId) throw new Error(t("storage.connect_workspace")); return client.storageConnections(workspaceId); }, enabled: Boolean(client && workspaceId) });
  const providers = useQuery({ queryKey: ["storage-oauth-providers", workspaceId], queryFn: () => { if (!client || !workspaceId) throw new Error(t("storage.connect_workspace")); return client.storageOAuthProviders(workspaceId); }, enabled: Boolean(client && workspaceId) });
  const passwords = useQuery({ queryKey: ["browser-passwords", client?.baseUrl], queryFn: () => { if (!client) throw new Error(t("research.unavailable")); return client.listBrowserPasswords(); }, enabled: Boolean(client?.canApprove) });
  const packages = useQuery({ queryKey: ["integration-packages", client?.baseUrl, props.workspaceKey], queryFn: () => props.skillTools!.importedPackages(), enabled: Boolean(props.skillTools && props.libraryConnection) });
  const refresh = () => {
    props.onRefresh();
    for (const key of ["storage-connections", "storage-oauth-providers", "settings", "browser-passwords", "integration-packages", "firm-hub"]) void cache.invalidateQueries({ queryKey: [key] });
  };
  useEffect(() => {
    const changed = () => { setVersion(value => value + 1); void cache.invalidateQueries({ queryKey: ["storage-connections"] }); void cache.invalidateQueries({ queryKey: ["settings", "connector-accounts"] }); };
    for (const event of [STORAGE_CHANGED_EVENT, CONNECTOR_SETTINGS_CHANGED, LEGALWORK_EXTENSION_STATE_CHANGED]) window.addEventListener(event, changed);
    return () => { for (const event of [STORAGE_CHANGED_EVENT, CONNECTOR_SETTINGS_CHANGED, LEGALWORK_EXTENSION_STATE_CHANGED]) window.removeEventListener(event, changed); };
  }, [cache]);
  useEffect(() => { body.current?.scrollTo(0, 0); }, [selectedId, category, search]);
  const select = (id: string | null) => {
    setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set("connection", id); else next.delete("connection"); return next; });
  };
  const toggleOnly = (entry: McpDirectoryInfo) => entry.kind === "extension" && entry.extensionManifest?.contributions?.some(value => value.type === "session-side-panel" || value.type === "session-rail-item");
  const configured = (entry: McpDirectoryInfo) => {
    if (mcp.mcpServers.some(server => server.name === getMcpIdentityKey(entry))) return true;
    if (entry.extensionManifest?.enablement && mcp.enablementContext) return evaluateEnablement(entry.extensionManifest.enablement, mcp.enablementContext).active;
    return toggleOnly(entry) ? isLegalWorkExtensionEnabled(entry) : mcp.isExtensionConnected?.(entry) ?? false;
  };
  const catalog: Item[] = [];
  for (const definition of connectorDefinitions) {
    const account = accounts.data?.connectors.find(item => item.id === definition.id);
    const installed = Boolean(account?.connections.length);
    catalog.push({ id: `native:${definition.id}`, name: definition.name, description: t(definition.descriptionKey), category: definition.kind === "files" ? "files" : "communication", popular: popularConnector(definition.id), icon: <Brand name={definition.name} slug={definition.icon} />, target: { kind: "native", id: definition.id }, installed, status: account && installed ? account.active === false ? "disabled" : connectorIsConnected(account) ? "connected" : "needs_auth" : undefined });
  }
  for (const entry of mcp.quickConnect) {
    if (connectorDefinitions.some(value => value.id === entry.id) || isLegalWorkExtensionHidden(entry)) continue;
    const id = entry.id ?? getMcpIdentityKey(entry);
    const installed = configured(entry);
    const server = mcp.mcpServers.find(value => value.name === getMcpIdentityKey(entry));
    catalog.push({ id: `service:${id}`, name: entry.name, description: entry.description, category: connectorCategory(id, entry.name), popular: Boolean(entry.featured), icon: <Brand name={entry.name} slug={entry.iconSlug} src={entry.iconSrc} />, target: { kind: "service", entry }, installed, status: server ? configuredConnectorState(server, mcp.mcpStatuses[server.name]) : undefined });
  }
  for (const kind of storageKinds) {
    const Icon = storageIcons[kind];
    catalog.push({ id: `storage:${kind}`, name: storageLabel(kind), description: storageDescription(kind), category: "files", icon: <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/60"><Icon className="size-5 text-muted-foreground" /></span>, target: { kind: "storage", storageKind: kind }, installed: false });
  }
  for (const provider of providers.data?.providers ?? []) {
    if (connectorDefinitions.some(value => value.id === provider.id)) continue;
    catalog.push({ id: `cloud:${provider.id}`, name: provider.name, description: t("connectors.files_description"), category: "files", icon: <Brand name={provider.name} />, target: { kind: "storage", storageKind: "oauth", provider }, installed: false });
  }
  for (const provider of legalResearchProviders) catalog.push({ id: `research:${provider.id}`, name: provider.name, description: new URL(provider.researchUrl).hostname, category: "legal", popular: popularConnector(provider.id), icon: <Brand name={provider.name} />, target: { kind: "research", provider }, installed: false });
  const installed: Item[] = catalog.filter(item => item.installed);
  for (const connection of storage.data?.connections ?? []) {
    // Native account roots already have one entry above. Named folder views remain separate.
    if (connection.id.startsWith("connector:")) continue;
    const provider = connection.config.kind === "oauth" ? providers.data?.providers.find(value => connection.config.kind === "oauth" && value.id === connection.config.provider) ?? connectorDefinitions.find(value => connection.config.kind === "oauth" && value.id === connection.config.provider) : undefined;
    const Icon = storageIcons[connection.config.kind];
    const value: Item = { id: `saved-storage:${connection.id}`, name: connection.name, description: provider?.name ?? storageLabel(connection.config.kind), category: "files", icon: <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/60"><Icon className="size-5 text-muted-foreground" /></span>, target: { kind: "storage", storageKind: connection.config.kind, connection, provider: provider ? cloudProvider(provider) : undefined }, installed: connection.team?.installed !== false, team: Boolean(connection.team), status: !connection.enabled || connection.team?.installed === false ? "disabled" : undefined };
    if (value.installed) installed.push(value); else catalog.push(value);
  }
  for (const connection of passwords.data?.items ?? []) {
    if (!connection.websites?.length) continue;
    const provider = legalResearchProviders.find(value => connection.websites.some(site => site.providerId === value.id || site.url === value.researchUrl));
    installed.push({ id: `saved-research:${connection.id}`, name: connection.label, description: provider?.name ?? connection.websites.map(site => site.name).join(", "), category: provider ? "legal" : "productivity", icon: <Brand name={provider?.name ?? connection.label} />, target: { kind: "research", provider, connection }, installed: true });
  }
  for (const plugin of packages.data ?? []) {
    if (plugin.sourceKind === "skill" || plugin.sourceKind === "connector") continue;
    const name = pluginImportName(plugin);
    installed.push({ id: `package:${plugin.pluginId}`, name, description: plugin.description ?? t("catalog.connection_description"), category: connectorCategory(plugin.name, name), icon: <Brand name={name} />, target: { kind: "package", plugin }, installed: true });
  }
  const firmItems = (team.data?.items ?? []).filter(item => item.kind === "mcp");
  for (const server of mcp.mcpServers) {
    if (importedConnectorPlugin(server.name, packages.data) || catalog.some(item => item.target.kind === "service" && getMcpIdentityKey(item.target.entry) === server.name) || firmItems.some(item => item.connector?.serverName === server.name)) continue;
    const name = pluginImportConnectorName(server.name);
    installed.push({ id: `server:${server.name}`, name, description: t("catalog.connection_description"), category: connectorCategory(server.name, name), icon: <Brand name={name} />, target: { kind: "server", name: server.name }, installed: true, status: configuredConnectorState(server, mcp.mcpStatuses[server.name]) });
  }
  for (const item of firmItems) {
    const name = firmConnectorName(item.name);
    const value: Item = { id: `team:${item.id}`, name, description: item.description, category: connectorCategory(item.name, name), icon: <Brand name={name} />, target: { kind: "team", item }, installed: item.added || item.installation === "automatic", team: true };
    catalog.push(value); if (value.installed) installed.push(value);
  }
  const selected = [...catalog, ...installed].find(item => item.id === selectedId);
  const related = selected ? installed.filter(item => item.id !== selected.id && (
    selected.target.kind === "research" && !selected.target.connection && item.target.kind === "research" && selected.target.provider?.id === item.target.provider?.id && Boolean(selected.target.provider)
    || selected.target.kind === "storage" && !selected.target.connection && item.target.kind === "storage" && selected.target.storageKind === item.target.storageKind && selected.target.provider?.id === item.target.provider?.id
    || selected.target.kind === "native" && item.target.kind === "storage" && item.target.connection?.config.kind === "oauth" && item.target.connection.config.provider === selected.target.id)) : [];
  const disabled = (item: Item) => props.busy ||  item.target.kind === "storage" && (storageForbidden || !workspaceId || !client) || item.target.kind === "research" && (!client?.canApprove || !workspaceId) || item.target.kind === "service" && (mcp.builtInExtensionDisabled?.(item.target.entry) || connectorsForbidden && !isBuiltInLegalWorkExtension(item.target.entry));
  const openStorage = async (editor: StorageEditor) => { if (!storageForbidden && await orgPolicyAllows("storage.allowPersonal")) setStorageEditor(editor); };
  const manage = (item: Item) => {
    if (disabled(item)) return;
    const target = item.target;
    if (target.kind === "storage") { if (!target.connection?.team) void openStorage({ kind: target.storageKind, provider: target.provider, connection: target.connection }); }
    else if (target.kind === "research") setResearchEditor(target);
    else if (target.kind === "server") setManagedServer(target.name);
    else if (target.kind === "package") setManagedPackage(target.plugin);
    else if (target.kind === "service") {
      const server = mcp.mcpServers.find(value => value.name === getMcpIdentityKey(target.entry));
      if (server) setManagedServer(server.name);
      else if (toggleOnly(target.entry)) { setLegalWorkExtensionEnabled(target.entry, true); refresh(); }
      else if (target.entry.requestAccessUrl) void platform.openLink(target.entry.requestAccessUrl);
      else if (!mcp.configSlotForEntry?.(target.entry)) {
        if (target.entry.requiresOauthClient || target.entry.requiresToken || /\{[^}]+\}/.test(target.entry.url ?? "")) setSetup(target.entry);
        else void Promise.resolve(mcp.connectMcp(target.entry)).catch(error => toast.error(error instanceof Error ? error.message : t("common.something_went_wrong")));
      }
    }
  };
  const canRemove = (item: Item) => {
    const target = item.target;
    return !item.team && (target.kind === "storage" && Boolean(target.connection) || target.kind === "research" && Boolean(target.connection) || target.kind === "server" || target.kind === "package" && props.canEditPlugins && props.skillTools || target.kind === "service" && (toggleOnly(target.entry) || mcp.mcpServers.some(server => server.name === getMcpIdentityKey(target.entry))));
  };
  const removeSelected = async () => {
    if (!remove || removing) return;
    setRemoving(true);
    try {
      const target = remove.target;
      if (target.kind === "storage" && target.connection && client && workspaceId) await client.removeStorageConnection(workspaceId, target.connection.id);
      else if (target.kind === "research" && target.connection && client) await client.deleteBrowserPassword(target.connection.id);
      else if (target.kind === "package") await props.skillTools?.removeImportedPackage(target.plugin.pluginId);
      else if (target.kind === "server") await mcp.removeMcp(target.name);
      else if (target.kind === "service") { if (toggleOnly(target.entry)) setLegalWorkExtensionEnabled(target.entry, false); else await mcp.removeMcp(getMcpIdentityKey(target.entry)); }
      setRemove(null); select(null); refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : t("common.something_went_wrong")); }
    finally { setRemoving(false); }
  };
  const detailsAccess: PluginDetailsAccess | undefined = props.skillDetails && props.renderPluginConnector ? { skills: props.skillDetails.skills, skillStore: props.skillDetails, canEditSkills: props.canAddSkill !== false, renderConnector: props.renderPluginConnector, readComponent: props.skillDetails.readPackageComponent } : undefined;
  const query = search.trim().toLocaleLowerCase();
  const matches = (item: Item) => `${item.name} ${item.description} ${categoryLabel(item.category)}`.toLocaleLowerCase().includes(query);
  const visibleCatalog = [...catalog, ...installed.filter(item => !catalog.some(value => value.id === item.id))].filter(matches);
  const sections = category ? [category] : query ? connectorCategories.filter(value => value !== "popular") : connectorCategories;
  const row = (item: Item) => <div key={item.id} className="group flex min-w-0 items-center gap-2 rounded-xl p-2.5 transition-colors hover:bg-muted/40">
    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => select(item.id)}>{item.icon}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.description}</span><MethodTags target={item.target} /></span></button>
    <Button variant="ghost" size="icon-sm" disabled={disabled(item)} aria-label={t(item.installed ? "catalog.manage_named" : "catalog.add_named", { name: item.name })} onClick={() => { select(item.id); if (!item.installed) manage(item); }}>{item.installed ? <MoreHorizontal className="size-4" /> : <Plus className="size-4" />}</Button>
  </div>;
  const target = selected?.target;
  const nativeId = target?.kind === "native" ? target.id : undefined;
  const nativeEntry = nativeId ? mcp.quickConnect.find(entry => entry.id === nativeId) : undefined;
  const nativeBlocked = Boolean(nativeEntry && mcp.builtInExtensionDisabled?.(nativeEntry)) || Boolean(nativeId && storageForbidden && connectorDefinitions.some(value => value.id === nativeId && value.kind === "files"));
  const extensionConfig = target?.kind === "service" && !mcp.builtInExtensionDisabled?.(target.entry) ? mcp.configSlotForEntry?.(target.entry) : null;
  const loading = accounts.isLoading || storage.isLoading || passwords.isLoading || packages.isLoading;
  const errors = [accounts.error, storage.error, providers.error, passwords.error, packages.error, team.error].filter(Boolean);

  return <div className="@container/integrations flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background" data-testid="connector-browser">
    <aside className="flex w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border/60 bg-muted/15 px-3 py-6 max-sm:hidden" aria-label={t("catalog.installed")}>
      <div className="px-2 text-sm font-semibold">{t("extensions.eyebrow_integrations")}</div>
      <button type="button" className={cn("flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted", !selectedId && "bg-muted font-medium")} onClick={() => { select(null); setCategory(null); setSearch(""); }}><Grid2X2 className="size-4" />{t("catalog.browse")}</button>
      <div><h2 className="mb-2 px-2.5 text-xs text-muted-foreground">{t("catalog.installed")}</h2>
        {installed.sort((a, b) => a.name.localeCompare(b.name)).map(item => <button key={item.id} type="button" aria-current={selectedId === item.id ? "page" : undefined} title={item.name} onClick={() => select(item.id)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-xs hover:bg-muted", selectedId === item.id && "bg-muted font-medium")}><span className="shrink-0 [&>span]:size-6 [&_img]:size-4 [&_svg]:size-4">{item.icon}</span><span className="min-w-0 truncate">{item.name}</span></button>)}
        {!installed.length ? <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">{t(loading ? "common.loading" : "catalog.no_connections")}</p> : null}
      </div>
    </aside>
    <main ref={body} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-8 @min-[1100px]/integrations:px-12">
      <div className="mx-auto w-full max-w-4xl space-y-8 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>{selectedId ? <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground" onClick={() => select(null)}><ArrowLeft className="size-4" />{t("catalog.browse")}</Button> : <><h1 className="text-2xl font-semibold tracking-tight">{t("extensions.eyebrow_integrations")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("catalog.description")}</p></>}</div>
          {!selectedId ? <div className="flex items-center gap-2"><div className="w-56"><IntegrationSearch value={search} onChange={setSearch} label={t("catalog.search")} /></div><Button variant="ghost" size="icon-sm" aria-label={t("common.refresh")} onClick={refresh}><RefreshCw className="size-4" /></Button><DropdownMenu><DropdownMenuTrigger render={<Button size="sm" />}><Plus className="size-4" />{t("common.add")}</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={connectorsForbidden || props.busy} onClick={async () => { if (await orgPolicyAllows("connectors.allowCustom")) setCustomOpen(true); }}><Plug />{t("catalog.custom_connection")}</DropdownMenuItem><DropdownMenuItem disabled={!client?.canApprove || !workspaceId} onClick={() => setResearchEditor({})}><Globe />{t("catalog.method_website_automation")}</DropdownMenuItem><DropdownMenuItem disabled={!props.pluginImports || !props.canEditPlugins || !props.canUseGlobalScope || pluginsForbidden} onClick={() => setImportOpen(true)}><Download />{t("catalog.import")}</DropdownMenuItem>{props.developerMode ? <DropdownMenuItem onClick={() => setEngineOpen(true)}><Settings2 />{t("extensions.engine_plugins")}</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></div> : null}
        </header>
        {errors.length ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-destructive/5 p-4 text-sm"><p>{t("catalog.load_failed")}</p><Button variant="outline" size="sm" onClick={refresh}>{t("common.refresh")}</Button></div> : null}
        {selected ? <article className="mx-auto max-w-2xl space-y-8">
          <div className="space-y-5"><div className="[&>span]:size-16 [&_img]:size-10 [&_svg]:size-8 [&>span]:text-2xl">{selected.icon}</div><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="break-words text-2xl font-semibold tracking-tight">{selected.name}</h1><p className="mt-2 text-sm text-muted-foreground">{categoryLabel(selected.category)}{selected.team ? ` · ${t("firm_hub.scope_team")}` : ""}</p><MethodTags target={selected.target} /></div><div className="flex flex-wrap gap-2">{canRemove(selected) ? <Button variant="ghost" size="icon-sm" aria-label={t("catalog.remove_named", { name: selected.name })} disabled={props.busy} onClick={() => setRemove(selected)}><Trash2 className="size-4" /></Button> : null}{target?.kind !== "native" && target?.kind !== "team" && !extensionConfig && !selected.team ? <Button disabled={disabled(selected)} onClick={() => manage(selected)}>{selected.installed ? <Settings2 className="size-4" /> : <Plus className="size-4" />}{t(selected.installed ? "catalog.manage" : "catalog.connect")}</Button> : null}</div></div></div>
          <div className="rounded-2xl bg-muted/40 p-6"><p className="text-sm leading-7">{selected.description}</p>{selected.status ? <div className="mt-4"><ConnectorStatus state={selected.status} /></div> : selected.installed ? <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" />{t("catalog.installed")}</p> : null}</div>
          {nativeBlocked ? <p className="text-sm text-muted-foreground">{t("mcp.builtins_blocked")}</p> : nativeId ? <ConnectorConfig key={nativeId} id={nativeId} legalworkServerClient={client} presentation="dialog" onExtensionConnectionChange={() => { void cache.invalidateQueries({ queryKey: ["settings", "connector-accounts"] }); void cache.invalidateQueries({ queryKey: ["storage-connections"] }); }} /> : null}
          {target?.kind === "service" && mcp.builtInExtensionDisabled?.(target.entry) ? <p className="text-sm text-muted-foreground">{t("mcp.builtins_blocked")}</p> : null}
          {extensionConfig}
          {target?.kind === "service" && target.entry.setupNote ? <p className="text-sm leading-6 text-muted-foreground">{target.entry.setupNote}</p> : null}
          {target?.kind === "service" && target.entry.learnMoreUrl ? <Button variant="link" className="px-0" onClick={() => void platform.openLink(target.entry.learnMoreUrl!)}>{t("catalog.website")}<ArrowUpRight className="size-3.5" /></Button> : null}
          {target?.kind === "research" ? <div className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">{t(target.provider ? "catalog.research_description" : "catalog.website_description")}</p><Button variant="link" className="px-0" onClick={() => { const url = target.provider?.researchUrl ?? target.connection?.websites[0]?.url; if (url) void platform.openLink(url); }}>{t("catalog.website")}<ArrowUpRight className="size-3.5" /></Button>{target.connection ? <Button className="ml-3" variant="outline" disabled={!client?.canApprove} onClick={() => setResearchEditor({ provider: target.provider, ...(target.provider ? {} : { template: target.connection }) })}><Plus className="size-4" />{t("catalog.add_another")}</Button> : null}</div> : null}
          {target?.kind === "storage" && target.connection && client && workspaceId ? <div className="space-y-4">{target.connection.team ? <p className="text-sm text-muted-foreground">{t(target.connection.teamInstallation === "optional" ? "integrations.team_optional" : "integrations.team_managed")}</p> : null}<p className="text-sm text-muted-foreground">{t(target.connection.readOnly ? "storage.read_only" : "storage.read_write")} · {t(target.connection.enabled ? "storage.enabled" : "storage.paused")}</p>{target.connection.config.kind === "oauth" && !target.connection.config.accountId ? <StorageOAuthSignIn client={client} workspaceId={workspaceId} connectionId={target.connection.id} revision={target.connection.updatedAt} onChanged={refresh} /> : null}{target.connection.team?.installed !== undefined && target.connection.teamInstallation === "optional" ? <Button variant="outline" onClick={() => { if (target.connection) void client.setTeamStorageInstalled(workspaceId, target.connection.id, !target.connection.team?.installed).then(refresh).catch(error => toast.error(error.message)); }}>{t(target.connection.team.installed ? "storage.remove_local" : "storage.install")}</Button> : null}{!target.connection.team ? <><Button variant="outline" disabled={storageForbidden} onClick={() => void openStorage({ kind: target.storageKind, provider: target.provider, ...(target.connection?.config.kind === "oauth" && target.connection.config.accountId ? { account: target.connection } : {}) })}><Plus className="size-4" />{t("catalog.add_another")}</Button>{target.provider && storage.data?.team?.canManage ? <Button variant="ghost" onClick={() => setSharing(target.connection ?? null)}>{t("storage.share_team")}</Button> : null}</> : null}</div> : null}
          {nativeId && connectorDefinitions.some(value => value.id === nativeId && value.kind === "files") && storage.data?.connections.some(value => value.id.startsWith(`connector:${nativeId}:`)) ? <Button variant="outline" disabled={storageForbidden} onClick={() => { const account = storage.data?.connections.find(value => value.id.startsWith(`connector:${nativeId}:`)); const definition = connectorDefinitions.find(value => value.id === nativeId); if (account && definition) void openStorage({ kind: "oauth", account, provider: cloudProvider(definition) }); }}><FolderOpen className="size-4" />{t("storage.add_folder_view")}</Button> : null}
          {target?.kind === "team" && client ? <FirmConnectorRow inline item={target.item} client={client} statuses={mcp.mcpStatuses} busy={props.busy} onChanged={refresh} onSignIn={(name, url) => { const entry = mcp.mcpServers.find(value => value.name === name); if (entry) mcp.authorizeMcp(entry); else void mcp.connectMcp({ name, serverName: name, description: target.item.description, type: "remote", url, oauth: true }); }} /> : null}
          {related.length ? <section className="space-y-3 border-t border-border/60 pt-6"><h2 className="text-sm font-medium">{t("catalog.your_connections")}</h2>{related.map(row)}</section> : null}
        </article> : selectedId ? <p role="status" className="text-sm text-muted-foreground">{t(loading ? "common.loading" : "catalog.not_found")}</p> : <>
          <nav aria-label={t("catalog.categories")} className="flex flex-wrap gap-2"><Button size="sm" variant={category === null ? "secondary" : "ghost"} className="rounded-full" onClick={() => setCategory(null)}>{t("catalog.all")}</Button>{connectorCategories.map(value => <Button key={value} size="sm" variant={category === value ? "secondary" : "ghost"} className="rounded-full" onClick={() => setCategory(value)}>{categoryLabel(value)}</Button>)}</nav>
          <div className="sm:hidden"><h2 className="mb-2 text-sm font-medium">{t("catalog.installed")}</h2>{installed.filter(matches).map(row)}</div>
          {sections.map(value => { const items = visibleCatalog.filter(item => value === "popular" ? item.popular : item.category === value).sort((a, b) => Number(b.target.kind === "research") - Number(a.target.kind === "research")); if (!items.length) return null; const displayed = category || query ? items : items.slice(0, 6); return <section key={value} className="space-y-3"><button type="button" onClick={() => setCategory(value)} className="flex items-center gap-1 text-sm font-medium">{categoryLabel(value)}<ChevronRight className="size-3.5 text-muted-foreground" /></button><div className="grid grid-cols-1 gap-x-8 gap-y-1 @min-[850px]/integrations:grid-cols-2">{displayed.map(row)}</div>{items.length > displayed.length ? <Button variant="link" size="sm" className="px-2.5 text-muted-foreground" onClick={() => setCategory(value)}>{t("catalog.see_all", { count: items.length })}</Button> : null}</section>; })}
          {!visibleCatalog.some(item => !category || category === "popular" ? !category || item.popular : item.category === category) ? <p className="py-12 text-center text-sm text-muted-foreground">{t("catalog.no_matches")}</p> : null}
        </>}
      </div>
    </main>
    {storageEditor && client && workspaceId ? <StorageConnectionDialog {...storageEditor} client={client} workspaceId={workspaceId} onClose={() => setStorageEditor(null)} onSaved={refresh} /> : null}
    {researchEditor && client && workspaceId ? <ResearchConnectionDialog {...researchEditor} client={client} workspaceId={workspaceId} onClose={() => setResearchEditor(null)} onSaved={refresh} /> : null}
    {sharing && client && workspaceId ? <ShareCloudStorageDialog client={client} workspaceId={workspaceId} connection={sharing} onClose={() => setSharing(null)} onSaved={refresh} /> : null}
    {managedServer ? cloneElement(props.mcpView, { detailsOnly: true, selectedMcp: managedServer, setSelectedMcp: setManagedServer }) : null}
    {managedPackage ? <IntegrationLibraryLayoutContext.Provider value={{ actions: null, search: null, connectorState: name => { const entry = mcp.mcpServers.find(server => server.name === name); return entry ? configuredConnectorState(entry, mcp.mcpStatuses[name]) : undefined; } }}><PluginDetailsDialog plugin={managedPackage} busy={props.busy} access={detailsAccess} imports={props.pluginImports} onChanged={refresh} onClose={() => setManagedPackage(null)} /></IntegrationLibraryLayoutContext.Provider> : null}
    <AddMcpModal open={customOpen} onClose={() => setCustomOpen(false)} onAdd={mcp.connectMcp} onProbe={mcp.probeMcp} onRegisterClient={mcp.registerMcpClient} busy={props.busy} isRemoteWorkspace={props.isRemoteWorkspace} />
    <McpConnectorSetupModal entry={setup} open={Boolean(setup)} onClose={() => setSetup(null)} onCancel={mcp.cancelPendingMcpAuth} onConnect={async entry => { const result = await mcp.connectMcp(entry); if (result !== false) setSetup(null); }} />
    {importOpen && props.pluginImports ? <PluginImportDialog connectionsOnly store={props.pluginImports} onClose={() => setImportOpen(false)} canImportPlugins={props.canEditPlugins && !pluginsForbidden} canImportSkills={false} canImportLocalSkills={false} onImported={() => { setImportOpen(false); refresh(); }} /> : null}
    {engineOpen && props.developerMode ? <Dialog open onOpenChange={setEngineOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t("extensions.engine_plugins")}</DialogTitle><DialogDescription>{t("plugins.desc")}</DialogDescription></DialogHeader><PluginsView extensions={props.extensions} busy={props.busy} selectedWorkspaceRoot={props.selectedWorkspaceRoot} canEditPlugins={props.canEditPlugins} canUseGlobalScope={props.canUseGlobalScope} accessHint={props.accessHint} suggestedPlugins={props.suggestedPlugins} /></DialogContent></Dialog> : null}
    <ConfirmModal open={Boolean(remove)} title={t("catalog.remove_named", { name: remove?.name ?? "" })} message={t(remove?.target.kind === "research" ? "catalog.remove_login_hint" : "catalog.remove_hint")} confirmLabel={t("common.remove")} cancelLabel={t("common.cancel")} confirmButtonVariant="destructive" onCancel={() => { if (!removing) setRemove(null); }} onConfirm={() => void removeSelected()} />
  </div>;
}
