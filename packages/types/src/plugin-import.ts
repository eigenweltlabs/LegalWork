export type PluginImportProvider = "chatgpt" | "claude";
export type PluginImportScope = "global" | "project";
export type PluginImportConnector = { name: string; project?: string; pluginRoot?: string };
export type PluginImportSource = { provider: PluginImportProvider; path: string; connector?: PluginImportConnector } | { provider: PluginImportProvider; zipBase64: string };
export type PluginImportCandidate = { path: string; name: string; version: string | null; displayName?: string; description?: string | null; kind?: "plugin" | "skill" | "connector"; connector?: PluginImportConnector; bundledIn?: { name: string; displayName?: string } };
export type PluginImportPreview = {
  id: string;
  digest: string;
  name: string;
  displayName?: string;
  description: string | null;
  version: string | null;
  format: "codex" | "claude" | "portable" | "skills" | "connectors";
  root: string;
  fileCount: number;
  bytes: number;
  components: Array<{ type: "skill" | "agent" | "command" | "mcp"; name: string; installedName: string }>;
  /** Import-time losses or behavior changes, not routine post-import setup. */
  warnings: string[];
};
export type PluginImportRequest = { source: PluginImportSource; root?: string; scope: PluginImportScope; digest?: string };
