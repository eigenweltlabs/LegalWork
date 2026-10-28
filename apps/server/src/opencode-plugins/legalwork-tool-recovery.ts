import { toolProgressGuard } from "./tool-progress-guard.js";

type SessionRequest = { path: { id: string }; query: { directory: string } };
type PluginInput = {
  directory: string;
  client: { session: {
    abort(input: SessionRequest): Promise<unknown>;
    prompt(input: SessionRequest & { body: { noReply: true; parts: { type: "text"; text: string; synthetic: true; metadata: { legalworkStop: { reason: "repeated-invalid-tool-calls"; messageID: string } } }[] } }): Promise<unknown>;
  } };
};

// Single export: OpenCode treats every export as a plugin factory.
export const LegalWorkToolRecovery = async (input: PluginInput) => {
  const recovery = toolProgressGuard(async (sessionID, reason, messageID) => {
    const request = { path: { id: sessionID }, query: { directory: input.directory } };
    await input.client.session.abort(request);
    await input.client.session.prompt({ ...request, body: { noReply: true, parts: [{
      type: "text", text: reason, synthetic: true,
      metadata: { legalworkStop: { reason: "repeated-invalid-tool-calls", messageID } },
    }] } });
  });
  return {
    event: recovery.event,
    "tool.definition": recovery.definition,
    "tool.execute.after": recovery.result,
    "experimental.chat.messages.transform": recovery.messages,
  };
};
