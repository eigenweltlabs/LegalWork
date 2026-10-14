import { realpath } from "node:fs/promises";
import type { ServerConfig, TokenScope } from "../types.js";
import { ApiError } from "../errors.js";
import { within, type SandboxMount } from "../agent-sandbox/files.js";

export type WikiProjectGrant = { wikiId: string; projectId: string; root: string; scope: TokenScope; origin: string };
type SessionAccess = { revision: number; grants: Map<string, WikiProjectGrant>; controller: AbortController };
const access = new WeakMap<ServerConfig, Map<string, SessionAccess>>();
function session(config: ServerConfig, id: string): SessionAccess {
  let sessions = access.get(config);
  if (!sessions) { sessions = new Map(); access.set(config, sessions); }
  let value = sessions.get(id);
  if (!value) { value = { revision: 0, grants: new Map(), controller: new AbortController() }; sessions.set(id, value); }
  return value;
}
export function wikiProjectAccessRevision(config: ServerConfig, sessionId: string) { return session(config, sessionId).revision; }
export function wikiProjectGrants(config: ServerConfig, sessionId: string) { return [...session(config, sessionId).grants.values()]; }
export function wikiProjectAccessSignal(config: ServerConfig, sessionId: string) { return session(config, sessionId).controller.signal; }
export function grantWikiProjectAccess(config: ServerConfig, sessionId: string, grant: WikiProjectGrant, revision: number) {
  const value = session(config, sessionId);
  if (value.revision !== revision) throw new ApiError(409, "wiki_project_access_changed", "Project access changed while approval was pending. Request it again.");
  value.grants.set(grant.projectId, grant);
}
export function revokeWikiProjectAccess(config: ServerConfig, sessionId: string, projectId?: string) {
  const value = session(config, sessionId);
  if (projectId) value.grants.delete(projectId); else value.grants.clear();
  value.revision++;
  value.controller.abort(new Error("Wiki project access was revoked."));
  value.controller = new AbortController();
}
export async function requireWikiProjectAccess(config: ServerConfig, sessionId: string, projectId: string, wikiId: string, origin: string, scope: TokenScope) {
  const grant = session(config, sessionId).grants.get(projectId);
  const project = config.workspaces.find(item => item.id === projectId && item.workspaceType !== "remote");
  const root = project ? await realpath(project.directory || project.path).catch(() => null) : null;
  if (!grant || grant.wikiId !== wikiId || grant.origin !== origin || grant.scope !== scope || grant.root !== root)
    throw new ApiError(403, "wiki_project_access_required", "This wiki chat needs the user's read-only approval for this project.");
  return grant;
}

/** Project folders cannot be reached through a broad, previously authorized mount. */
export async function wikiProjectSandboxMounts(config: ServerConfig, wikiId: string, wikiWorkspaceIds: Set<string>, sessionId: string,
  origin: string, scope: TokenScope, mounts: SandboxMount[]): Promise<SandboxMount[]> {
  const roots = await Promise.all(config.workspaces.filter(project => !wikiWorkspaceIds.has(project.id) && project.workspaceType !== "remote").map(async project => ({
    id: project.id, root: await realpath(project.directory || project.path).catch(() => null),
  })));
  const result: SandboxMount[] = [];
  for (const mount of mounts) {
    const source = await realpath(mount.source);
    let writable = mount.writable;
    for (const project of roots) {
      if (!project.root || !within(source, project.root) && !within(project.root, source)) continue;
      if (!within(project.root, source)) throw new ApiError(403, "wiki_project_mount_too_broad", "Choose the specific approved project folder, not a parent folder.");
      await requireWikiProjectAccess(config, sessionId, project.id, wikiId, origin, scope);
      writable = false;
    }
    result.push({ ...mount, source, writable });
  }
  return result;
}
