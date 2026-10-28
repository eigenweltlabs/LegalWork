import { relative, resolve, isAbsolute } from "node:path";
import { beginFileEditorHandoff } from "../file-editor-handoff.js";
import { cancelUiBridgeRequests } from "../inapp-document-bridge.js";

/** Native file tools have no execution wrapper, so pair the before/after hooks
 * and the engine's error event. Shell processes are coordinated at execution. */
export function nativeFileEdits(directory?: string, begin = beginFileEditorHandoff, cancel = cancelUiBridgeRequests) {
  type Operation = { controller: AbortController; ready: Promise<void>; finish?: () => Promise<void>; pending?: Promise<void> };
  const active = new Map<string, Operation>();
  const key = (sessionID: string, callID: string) => `${sessionID}:${callID}`;
  const finish = async (sessionID: string, callID: string) => {
    const id = key(sessionID, callID), operation = active.get(id);
    if (!operation) return;
    operation.controller.abort();
    operation.pending ??= operation.ready.catch(() => {}).then(() => operation.finish?.()).finally(() => active.delete(id));
    await operation.pending;
  };
  return {
    async before(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) {
      if (!["write", "edit", "multiedit", "apply_patch"].includes(input.tool)) return;
      if (!process.env.LEGALWORK_UI_CONTROL_DISCOVERY) return;
      const raw = output.args.filePath ?? output.args.path;
      let paths: string[] | undefined;
      if (typeof raw === "string" && directory) {
        const path = relative(directory, resolve(directory, raw)).replace(/\\/g, "/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path)) return;
        paths = [path];
      }
      const id = key(input.sessionID, input.callID);
      const operation: Operation = { controller: new AbortController(), ready: Promise.resolve() };
      active.set(id, operation);
      operation.ready = (async () => { operation.finish = await begin(input.sessionID, paths, undefined, operation.controller.signal); operation.controller.signal.throwIfAborted(); })();
      try { await operation.ready; }
      catch (error) { await finish(input.sessionID, input.callID); throw error; }
    },
    after: finish,
    async event(input: { event: { type: string; properties?: unknown } }) {
      if (input.event.type === "session.error" && process.env.LEGALWORK_UI_CONTROL_DISCOVERY) {
        const properties = input.event.properties;
        const session: unknown = properties && typeof properties === "object" ? Reflect.get(properties, "sessionID") : undefined;
        const error: unknown = properties && typeof properties === "object" ? Reflect.get(properties, "error") : undefined;
        if (typeof session === "string" && error && typeof error === "object" && Reflect.get(error, "name") === "MessageAbortedError") {
          for (const [id, operation] of active) if (id.startsWith(`${session}:`)) operation.controller.abort();
          await cancel(session);
        }
        return;
      }
      if (input.event.type !== "message.part.updated") return;
      const properties = input.event.properties;
      const part: unknown = properties && typeof properties === "object" ? Reflect.get(properties, "part") : undefined;
      if (!part || typeof part !== "object" || Reflect.get(part, "type") !== "tool") return;
      const state: unknown = Reflect.get(part, "state"), session: unknown = Reflect.get(part, "sessionID"), call: unknown = Reflect.get(part, "callID");
      if (state && typeof state === "object" && ["error", "completed"].includes(Reflect.get(state, "status")) && typeof session === "string" && typeof call === "string") await finish(session, call);
    },
  };
}
