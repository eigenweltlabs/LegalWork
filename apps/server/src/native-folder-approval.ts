import { dirname, isAbsolute, join } from "node:path";
import { canonicalFilePath } from "./file-write-lock.js";
import { permissionPatternMatches } from "./agent-sandbox/permissions.js";
import { createEngineClient } from "./engine-client.js";
import { ApiError } from "./errors.js";
import { requireOrgPolicyToolsUnmanaged } from "./org-policy.js";
import { runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { writeLegalworkRuntimeConfigFile } from "./legalwork-runtime-config.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

/** The native "always" scope is a Git project, which may contain several
 * LegalWork projects. Remember the exact requested folders in the existing
 * project settings and settle this native request once instead. */
export async function rememberNativeFolderApproval(config: ServerConfig, workspace: WorkspaceInfo, sessionID: string, requestID: string) {
  const client = createEngineClient(config, workspace);
  const request = await client.permission.get({ sessionID, requestID });
  if (request.action !== "external_directory") return false;
  await requireOrgPolicyToolsUnmanaged(config, ["external_directory"]);
  const resources = (await Promise.all(request.resources.map(async resource => {
    const folder = dirname(resource);
    if (!resource.replaceAll("\\", "/").endsWith("/*") || !isAbsolute(folder) || /[*?]/.test(folder)) {
      throw new ApiError(400, "folder_approval_not_persistable", "This folder cannot be represented as an exact saved grant. Use Allow once.");
    }
    return [join(folder, "*"), join(await canonicalFilePath(folder), "*")].map(path => path.replaceAll("\\", "/"));
  }))).flat();
  // Revalidate that the request still exists before storing a persistent grant.
  await client.permission.get({ sessionID, requestID });
  await writeRuntimeOpencodeConfig(config, workspace.id, current => {
    const existing = Object.entries(runtimeExternalDirectory(current)).filter(([resource]) => !resources.includes(resource));
    for (const resource of new Set(resources)) {
      // Insert after the effective parent rule. Keep every existing rule in
      // order so unrelated permissions and later child restrictions survive.
      let index = -1;
      for (let position = 0; position < existing.length; position++) {
        if (permissionPatternMatches(resource, existing[position][0])) index = position;
      }
      existing.splice(index + 1, 0, [resource, "allow"]);
    }
    return { ...current, permission: { ...current.permission, external_directory: Object.fromEntries(existing) } };
  });
  await writeLegalworkRuntimeConfigFile(config, workspace.id);
  const session = await client.session.get({ sessionID });
  await client.rpc.call({ rpcID: "legalwork.managed-settings", method: "refresh", input: {}, location: session.location });
  return true;
}
