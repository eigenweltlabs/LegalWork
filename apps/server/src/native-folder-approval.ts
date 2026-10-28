import { createHash, randomUUID } from "node:crypto";
import { createEngineClient, getWorkspaceEngineSession } from "./engine-client.js";
import { ApiError } from "./errors.js";
import { canonicalFilePath } from "./file-write-lock.js";
import { requireOrgPolicyToolsUnmanaged } from "./org-policy.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { writeLegalworkRuntimeConfigFile } from "./legalwork-runtime-config.js";
import { readManagedEngineSettings } from "./managed-engine-settings.js";
import { managedEngineSettingsFilePath } from "./legalwork-runtime-config.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

export type NativeProjectApproval = {
  id: string;
  action: string;
  resources: string[];
  createdAt: number;
  updatedAt?: number;
};

function publicID(approval: NativeProjectApproval, resource: string) {
  return approval.resources.length === 1 ? approval.id
    : `psv_${createHash("sha256").update(JSON.stringify([approval.id, resource])).digest("hex")}`;
}

/** Saved native engine approvals are keyed by Git project. LegalWork owns the
 * product's remembered grants by its own project ID, including non-Git cases. */
export async function listNativeProjectApprovals(config: ServerConfig, workspace: WorkspaceInfo) {
  const saved = await readRuntimeOpencodeConfig(config, workspace.id);
  return (saved.projectPermissionApprovals ?? []).flatMap(approval => approval.resources.map(resource => ({
    id: publicID(approval, resource), projectID: workspace.id, action: approval.action, resource,
    time: { created: approval.createdAt, updated: approval.updatedAt ?? approval.createdAt },
  })));
}

export async function removeNativeProjectApproval(config: ServerConfig, workspace: WorkspaceInfo, id: string): Promise<void> {
  await writeRuntimeOpencodeConfig(config, workspace.id, current => {
    const records = current.projectPermissionApprovals ?? [];
    const selected = records.find(record => record.resources.some(resource => publicID(record, resource) === id));
    if (!selected) throw new ApiError(404, "permission_not_found", "Saved permission not found in this project.");
    return { ...current, projectPermissionApprovals: records.flatMap(record => {
      if (record !== selected) return [record];
      const resources = record.resources.filter(resource => publicID(record, resource) !== id);
      return resources.length ? [{ ...record, resources }] : [];
    }) };
  });
  await writeLegalworkRuntimeConfigFile(config, workspace.id);
}

export async function updateNativeProjectApproval(config: ServerConfig, workspace: WorkspaceInfo, id: string, updates: { action?: string; resource?: string }) {
  if (updates.action !== undefined && (typeof updates.action !== "string" || !updates.action)
    || updates.resource !== undefined && (typeof updates.resource !== "string" || !updates.resource)) {
    throw new ApiError(400, "invalid_permission", "A saved permission action and resource must be nonempty strings.");
  }
  const previous = (await listNativeProjectApprovals(config, workspace)).find(record => record.id === id);
  if (!previous) throw new ApiError(404, "permission_not_found", "Saved permission not found in this project.");
  await requireOrgPolicyToolsUnmanaged(config, [previous.action, updates.action ?? previous.action]);
  await writeRuntimeOpencodeConfig(config, workspace.id, current => {
    const records = current.projectPermissionApprovals ?? [];
    const selected = records.find(record => record.resources.some(resource => publicID(record, resource) === id));
    if (!selected) throw new ApiError(404, "permission_not_found", "Saved permission not found in this project.");
    const resource = selected.resources.find(resource => publicID(selected, resource) === id);
    if (resource === undefined) throw new ApiError(404, "permission_not_found", "Saved permission not found in this project.");
    const others = selected.resources.filter(resource => publicID(selected, resource) !== id);
    const replacement = { id, action: updates.action ?? selected.action, resources: [updates.resource ?? resource],
      createdAt: selected.createdAt, updatedAt: Date.now() };
    return { ...current, projectPermissionApprovals: records.flatMap(record => record === selected
      ? [...(others.length ? [{ ...record, resources: others }] : []), replacement] : [record]) };
  });
  await writeLegalworkRuntimeConfigFile(config, workspace.id);
  const result = (await listNativeProjectApprovals(config, workspace)).find(record => record.id === id);
  if (!result) throw new ApiError(503, "permission_approval_not_published", "The updated permission was not published.");
  return result;
}

/** Verify the product's project-scoped evaluation hook before accepting a saved
 * grant. An ordinary OpenCode-only server cannot promise this ownership scope. */
async function assertProjectApprovalIntegration(config: ServerConfig, workspace: WorkspaceInfo, sessionID: string) {
  const client = createEngineClient(config, workspace);
  const session = await getWorkspaceEngineSession(client, workspace, sessionID);
  const result = await client.rpc.call({ rpcID: "legalwork.managed-settings", method: "permissionScope", input: {}, location: session.location })
    .catch(() => { throw new ApiError(409, "project_permission_integration_unavailable", "This engine does not support remembered LegalWork project permissions. Use Allow once."); });
  const value = result.output;
  if (!value || typeof value !== "object" || !('version' in value) || value.version !== 2 || !('remembered' in value) || value.remembered !== "legalwork-project"
    || !('directory' in value) || typeof value.directory !== "string"
    || await canonicalFilePath(value.directory) !== await canonicalFilePath(workspace.directory?.trim() || workspace.path)) {
    throw new ApiError(409, "project_permission_integration_unavailable", "This engine cannot verify remembered permissions for this LegalWork project. Use Allow once.");
  }
  return { client, session };
}

/** Never turn a temporary prompt into a wider guessed wildcard. Native v2's
 * own "always" implementation stores request.save, not request.resources. */
export function nativeProjectApprovalResources(request: { action: string; save?: readonly string[] }) {
  if (!request.action || !request.save?.length || request.save.some(resource => !resource)) {
    throw new ApiError(400, "permission_approval_not_persistable", "This request has no persistent approval scope. Use Allow once.");
  }
  return [...new Set(request.save)];
}

/** Publish only native action/resources metadata. The permission integration
 * reads it for the exact LegalWork project; the pending engine reply stays once. */
export async function rememberNativeProjectApproval(config: ServerConfig, workspace: WorkspaceInfo, sessionID: string, requestID: string): Promise<boolean> {
  const { client } = await assertProjectApprovalIntegration(config, workspace, sessionID);
  const request = await client.permission.get({ sessionID, requestID });
  const resources = nativeProjectApprovalResources(request);
  await requireOrgPolicyToolsUnmanaged(config, [request.action]);
  // Revalidate the pending request immediately before publishing its grant.
  const currentRequest = await client.permission.get({ sessionID, requestID });
  if (currentRequest.action !== request.action || JSON.stringify(currentRequest.save) !== JSON.stringify(request.save)) {
    throw new ApiError(409, "permission_approval_changed", "This permission request changed. Review it again before remembering access.");
  }
  const now = Date.now();
  await writeRuntimeOpencodeConfig(config, workspace.id, current => {
    const records = current.projectPermissionApprovals ?? [];
    const additions = resources.filter(resource => !records.some(record => record.action === request.action && record.resources.includes(resource)))
      .map(resource => ({ id: `psv_${randomUUID().replaceAll("-", "")}`, action: request.action, resources: [resource], createdAt: now }));
    return { ...current, projectPermissionApprovals: [...records, ...additions] };
  });
  await writeLegalworkRuntimeConfigFile(config, workspace.id);
  // The product permission hook reads the atomic private settings file at
  // each evaluation. No Location reload is needed (it would cancel this ask).
  const published = await readManagedEngineSettings(managedEngineSettingsFilePath(config), workspace.directory?.trim() || workspace.path);
  if (!resources.every(resource => published.projectPermissionApprovals.some(record => record.action === request.action && record.resources.includes(resource)))) {
    throw new ApiError(503, "permission_approval_not_published", "The saved project approval is not active yet. Retry before continuing.");
  }
  return true;
}
