import { isRpcError, type OpenCodeClient } from "@opencode/client";
import { Schema } from "effect";
import { ApiError, findApiError } from "./errors.js";
import { commandSettingsRpc } from "./native-command-rpc.js";

const cancelledSchema = Schema.Struct({ cancelled: Schema.Boolean });

/** The native configured-command loader expands shell outside the shell hook. */
export async function assertManagedCommandIntegration(client: OpenCodeClient, location: { directory: string }): Promise<void> {
  const plugins = (await client.plugin.list({ location })).data;
  if (!plugins.some(plugin => plugin.id === commandSettingsRpc.id && plugin.state.status === "active")
    || plugins.some(plugin => plugin.id === "opencode.config.command")) {
    throw new ApiError(503, "managed_commands_unavailable", "LegalWork's managed command integration is not ready. Reload the engine before running this shortcut so its shell steps use this chat's permissions and sandbox.");
  }
}

function missingCommandRpc(error: unknown): boolean {
  const api = findApiError(error);
  const detail = api?.details;
  const body = detail && typeof detail === "object" && "detail" in detail ? detail.detail : error;
  return isRpcError(body) && (body.type === "rpc.unavailable" || body.type === "rpc.method_not_found");
}

/** Native interrupt alone cannot see a command still expanding its template. */
export async function interruptEngineSession(client: OpenCodeClient, sessionID: string, options: { managedCommands: boolean }): Promise<{ interrupted: boolean }> {
  const session = await client.session.get({ sessionID });
  const [command, execution] = await Promise.allSettled([
    client.rpc.call({ rpcID: commandSettingsRpc.id, method: "cancel", input: { sessionID }, location: session.location }),
    client.session.interrupt({ sessionID }),
  ]);
  // Attempt both: a broken command integration must still stop a model turn.
  // Standalone engines need not install LegalWork's command integration.
  if (command.status === "rejected" && (options.managedCommands || !missingCommandRpc(command.reason))) throw command.reason;
  if (execution.status === "rejected") throw execution.reason;
  const cancelled = command.status === "fulfilled" && Schema.decodeUnknownSync(cancelledSchema)(command.value.output).cancelled;
  return { interrupted: execution.value.interrupted || cancelled };
}
