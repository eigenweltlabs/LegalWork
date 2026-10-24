import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AssistantSubmission } from "@legalwork/types/launcher";
import type { SubmissionPayload } from "./assistant-submissions.js";
import type { SessionMessageQueue } from "./session-message-queue.js";
import { ApiError } from "./errors.js";

function commandArguments(payload: SubmissionPayload) {
  const context = payload.parts.flatMap(part => part.type === "text" && part.synthetic ? [part.text] : []).join("\n\n");
  return [payload.command?.arguments, context].filter(Boolean).join("\n\n");
}

/** Home keeps the durable queue, including edit/reorder/stop, while using the
 * same frozen request, project constraint and engine message ID as the panel. */
export async function enqueueAssistantSubmission(queue: Pick<SessionMessageQueue, "act">, entry: AssistantSubmission, payload: SubmissionPayload) {
  if (!payload.queue || !payload.model) throw new ApiError(400, "submission_queue", "Choose a model before queuing this message.");
  const preferences = { agent: payload.agent ?? "legalwork", variant: payload.variant };
  return queue.act(entry.workspaceId, entry.sessionId, { type: "enqueue", ...payload.queue, messageId: entry.messageId,
    execution: payload.command ? { kind: "command", command: payload.command.name, arguments: commandArguments(payload), model: `${payload.model.providerID}/${payload.model.modelID}`, ...preferences, parts: payload.parts.filter(part => part.type === "file") }
      : { kind: "prompt", parts: payload.parts, model: payload.model, ...preferences },
  });
}

/** Preserve the engine's command semantics and the common operation identity. */
export async function sendAssistantSubmission(client: OpencodeClient, entry: AssistantSubmission, payload: SubmissionPayload) {
  if (payload.command) {
    const result = await client.session.command({ sessionID: entry.sessionId, messageID: entry.messageId, command: payload.command.name,
      arguments: commandArguments(payload), agent: payload.agent,
      model: payload.model ? `${payload.model.providerID}/${payload.model.modelID}` : undefined, variant: payload.variant,
      parts: payload.parts.filter(part => part.type === "file"),
    }, { signal: AbortSignal.timeout(30000) });
    if (!result.response.ok) throw new Error("Command delivery could not be confirmed.");
    return;
  }
  const result = await client.session.promptAsync({ sessionID: entry.sessionId, messageID: entry.messageId, agent: payload.agent ?? "legalwork",
    ...(payload.model ? { model: payload.model } : {}), ...(payload.variant ? { variant: payload.variant } : {}), parts: payload.parts }, { signal: AbortSignal.timeout(30000) });
  if (!result.response.ok) throw new Error("Message delivery could not be confirmed.");
}
