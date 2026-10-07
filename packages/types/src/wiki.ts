/** Wiki content and configuration live in Markdown; these are API projections. */
export type WikiValue = string | number | boolean | null | WikiValue[] | { [key: string]: WikiValue };

export type WikiSyncSettings = { workspaceId: string; connectionId: string; path: string };
export type WikiSyncStatus = {
  state: "local" | "idle" | "syncing" | "error";
  lastSyncedAt: number | null;
  error: string | null;
  conflicts: string[];
};
export type WikiRegistration = {
  id: string;
  name: string;
  root: string;
  workspaceId: string;
  allowInProjects: boolean;
  /** Omitted/null permits all projects; an array restricts project tool access. */
  projectWorkspaceIds?: string[] | null;
  sync: WikiSyncSettings | null;
};
export type WikiVault = WikiRegistration & {
  writable: boolean;
  pageCount: number;
  totalBytes: number;
  syncStatus: WikiSyncStatus;
};
export type WikiLink = { target: string; label: string; property: string | null; resolved: boolean };
export type WikiPage = {
  path: string;
  title: string;
  type: string;
  properties: Record<string, WikiValue>;
  links: WikiLink[];
  excerpt: string;
  revision: string;
  updatedAt: number;
};
export type WikiAsset = { path: string; size: number; updatedAt: number; changedAt?: number };
export type WikiView = {
  name: string;
  type: "table" | "kanban";
  filter: Record<string, WikiValue>;
  columns: string[];
  groupBy?: string;
};
export type WikiSnapshot = {
  wiki: WikiVault;
  pages: WikiPage[];
  assets: WikiAsset[];
  views: WikiView[];
  warnings: string[];
};
export type WikiDocument = { path: string; content: string; revision: string; updatedAt: number };
export type WikiRevision = { id: string; path: string; createdAt: number; action: "write" | "delete" | "restore"; size: number };
export type WikiCreateInput = {
  name: string;
  root?: string;
  template?: "firm" | "blank";
  /** Join an existing shared folder without seeding local starter content. */
  attach?: boolean;
  sync?: WikiSyncSettings | null;
};
export type WikiUpdateInput = { name?: string; allowInProjects?: boolean; projectWorkspaceIds?: string[] | null; sync?: WikiSyncSettings | null };
