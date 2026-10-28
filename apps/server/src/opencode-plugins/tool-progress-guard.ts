import { z } from "zod";
import { toolValidationFeedback } from "./tool-validation-feedback.js";

const partEvent = z.object({ part: z.object({
  id: z.string(), sessionID: z.string(), messageID: z.string(), type: z.literal("tool"), tool: z.string(),
  state: z.object({ status: z.string(), input: z.unknown(), error: z.string().optional() }),
}) });
type ModelPart = {
  type: string; id: string; sessionID: string; messageID: string; tool?: string;
  state?: { status: string; input: unknown; error?: string };
};
type FailureRun = {
  fingerprint: string; count: number; seen: Set<string>; stopped: boolean;
  warningMessageID?: string; recoverySteps: Set<string>;
};
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, ordered(entry)]));
  return value;
}
function fingerprint(tool: string, input: unknown) { return JSON.stringify([tool, ordered(input)]); }

/** Shared by all tools. The model receives correction guidance before
 * any stop; parallel calls in one assistant step cannot exhaust recovery. */
export function toolProgressGuard(stop: (sessionID: string, reason: string, messageID: string) => Promise<void>) {
  const feedback = toolValidationFeedback();
  const userMessages = new Map<string, string>();
  const runs = new Map<string, FailureRun>();
  const event = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type === "message.updated") {
      const info = z.object({ info: z.object({ id: z.string(), sessionID: z.string(), role: z.string() }) }).safeParse(event.properties);
      if (info.success && info.data.info.role === "user" && userMessages.get(info.data.info.sessionID) !== info.data.info.id) {
        runs.delete(info.data.info.sessionID);
        userMessages.set(info.data.info.sessionID, info.data.info.id);
      }
      return;
    }
    if (event.type === "session.idle" || event.type === "session.deleted") {
      const info = z.object({ sessionID: z.string().optional(), info: z.object({ id: z.string() }).optional() }).safeParse(event.properties);
      if (info.success) {
        const id = info.data.sessionID ?? info.data.info?.id ?? "";
        runs.delete(id);
        userMessages.delete(id);
      }
      return;
    }
    if (event.type !== "message.part.updated") return;
    const parsed = partEvent.safeParse(event.properties);
    if (!parsed.success) return;
    const part = parsed.data.part;
    if (part.state.status === "completed") { runs.delete(part.sessionID); return; }
    if (part.state.status !== "error") return;
    const guidance = feedback.failure(part.tool, part.state.input, part.state.error ?? "");
    if (!guidance) { runs.delete(part.sessionID); return; }
    const key = fingerprint(part.tool, part.state.input);
    let run = runs.get(part.sessionID);
    if (!run || run.fingerprint !== key) {
      run = { fingerprint: key, count: 0, seen: new Set(), stopped: false, recoverySteps: new Set() };
      runs.set(part.sessionID, run);
    }
    if (run.stopped || run.seen.has(part.id)) return;
    run.seen.add(part.id);
    run.count++;
    if (!run.warningMessageID || run.warningMessageID === part.messageID) return;
    run.recoverySteps.add(part.messageID);
    if (run.recoverySteps.size < 3) return;
    run.stopped = true;
    await stop(part.sessionID, `Stopped because identical invalid calls to ${part.tool} continued for three assistant steps after correction guidance. ${guidance}`, part.messageID);
  };
  const messages = async (_input: unknown, output: { messages: { parts: ModelPart[] }[] }) => {
    // Amend the latest failed result only in the next model request. Do not add
    // a user turn or change the fixed system prompt and its cache prefix.
    for (const message of [...output.messages].reverse()) {
      for (const part of [...message.parts].reverse()) {
        if (part.type !== "tool" || !part.tool || part.state?.status !== "error" || part.state.error === undefined) continue;
        const marker = "\n\n[LegalWork tool recovery]";
        const original = part.state.error.split(marker)[0];
        const hint = feedback.failure(part.tool, part.state.input, original);
        if (!hint) continue;
        const run = runs.get(part.sessionID);
        if (!run || run.fingerprint !== fingerprint(part.tool, part.state.input)) continue;
        const warning = run.recoverySteps.size === 2
          ? "Final warning: one retry remains. If the next call uses the same tool and arguments and fails validation again, LegalWork will forcibly stop this run. Correct the arguments, choose another approach, or explain what information is missing."
          : run.count >= 3
            ? `The same tool and arguments have failed repeatedly. Repeating this call cannot succeed. Change the arguments, choose another approach, or explain what information is missing. This run will stop only if the same invalid call continues for ${run.recoverySteps.size === 0 ? "three" : "two"} further assistant steps without progress.`
            : "Correct these arguments before retrying.";
        part.state.error = original + `${marker}\n${warning}\n${hint}`;
        if (run.count >= 3 && !run.warningMessageID) run.warningMessageID = part.messageID;
        return;
      }
    }
  };
  return { event, messages, definition: feedback.definition, result: feedback.result };
}
