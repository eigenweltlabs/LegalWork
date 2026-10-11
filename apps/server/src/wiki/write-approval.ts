import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { WikiRegistration } from "@legalwork/types/wiki";
import type { ApprovalRequest, ServerConfig } from "../types.js";
import type { RequestContext } from "../routes/registry.js";
import { ApiError } from "../errors.js";
import { authenticateWikiAgentRequest } from "./agent-access.js";

const within = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/** Cross-workspace writes always pause in the originating chat, even in auto mode. */
export async function approveWikiWrite(ctx: RequestContext, config: ServerConfig, wiki: WikiRegistration,
  input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  standard: (ctx: RequestContext, input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">) => Promise<void>,
) {
  const agent = await authenticateWikiAgentRequest(config, ctx.request);
  if (!agent || within(await realpath(wiki.root), agent.directory)) return standard(ctx, input);
  const candidates = await Promise.all(config.workspaces.map(async workspace => {
    const root = await realpath(workspace.directory || workspace.path).catch(() => null);
    return root && within(root, agent.directory) ? { workspace, root } : null;
  }));
  const source = candidates.filter(value => value !== null).sort((a, b) => b.root.length - a.root.length)[0];
  if (!source) throw new ApiError(403, "wiki_workspace_unknown", "The requesting chat has no registered workspace.");
  const result = await ctx.approvals.requestApproval({ ...input, actor: agent.actor,
    workspaceId: source.workspace.id, sessionID: agent.sessionId,
    summary: `${input.summary} (from ${source.workspace.name})`,
  }, ctx.request.signal, true);
  if (!result.allowed) throw new ApiError(403, "write_denied", "Wiki change was not approved.", { requestId: result.id, reason: result.reason });
}
