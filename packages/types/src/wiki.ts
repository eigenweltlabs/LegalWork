/** Wiki content and configuration live in Markdown; these are API projections. */
export type WikiValue = string | number | boolean | null | WikiValue[] | { [key: string]: WikiValue };

/** Kept so older registrations remain readable while their sharing is upgraded. */
export type WikiLegacySyncSettings = { workspaceId: string; connectionId: string; path: string };
export type WikiTeamSyncSettings = { kind: "team"; wikiId: string; orgId: string };
export type WikiSyncSettings = WikiTeamSyncSettings | WikiLegacySyncSettings;
export type WikiSharingInput = { access: "org" | "members"; memberIds: string[] };
export type WikiTeamRecord = WikiSharingInput & {
  id: string;
  name: string;
  ownerUserId: string;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
};
export type WikiTeamMember = { userId: string; name: string | null; email: string | null; role: string };
export type WikiTeamOverview = { orgId: string; userId: string; orgName: string | null; items: WikiTeamRecord[]; members: WikiTeamMember[] };
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
  /** Fresh, server-authorized sharing information; absent while unavailable. */
  sharing?: WikiTeamRecord | null;
  /** Audience of an incomplete sharing request, for a safe retry. */
  pendingSharing?: WikiSharingInput | null;
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
  /** Attach an existing folder without seeding local starter content. */
  attach?: boolean;
  sync?: WikiSyncSettings | null;
  sharing?: WikiSharingInput;
};
export type WikiUpdateInput = { name?: string; allowInProjects?: boolean; projectWorkspaceIds?: string[] | null; sync?: WikiSyncSettings | null };
