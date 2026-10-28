import type { Plugin } from "@opencode/plugin";
import { OpenCode } from "@opencode/client";
import { z } from "zod";
import { browserPasswordRequestSchema } from "../native-shared-values.js";
import { browserUrl, requestBrowser } from "./legalwork-browser-tools.js";
import { requireBrowserNetwork } from "./browser-network-policy.js";
import { nativeTool } from "./native-tool.js";
import { serverToken, serverUrl } from "./office-plugin-shared.js";

const listing = z.object({ website: z.string().nullable(), passwords: z.array(z.object({
  id: z.string().uuid(), label: z.string(), username: z.string(),
})) });

export function browserPasswordRequestTool(ctx: Plugin.Context) {
  return nativeTool(ctx, {
    name: "legalwork_browser_request_password",
    description: "Show an inline saved-login form in this chat when a website needs sign-in and no matching password is available. Use the current tab's browser_url. The website is checked by the desktop, not supplied by the agent. Waits for the user to save or cancel, then returns only saved-entry metadata. Password input goes directly to LegalWork's vault, never through chat or native form answers. Reuse the returned ID with legalwork_browser_fill_password and a fresh observed field ref. If cancelled, do not ask again unless the user requests it. Local desktop browser only.",
    schema: z.object({ browser_url: browserUrl, label: z.string().trim().min(1).max(200).optional(), username: z.string().max(500).optional() }),
    async execute(input, context) {
      if (!context.sessionID || !context.abort) throw new Error("A browser password request requires its calling chat.");
      const sessionID = context.sessionID, signal = context.abort;
      const { workspaceId } = await requireBrowserNetwork(context);
      // The plugin domain omits forms; use the supported native HTTP API through
      // LegalWork's existing project/session admission proxy.
      const native = OpenCode.make({ baseUrl: `${serverUrl()}/workspace/${encodeURIComponent(workspaceId)}/opencode`,
        headers: { Authorization: `Bearer ${serverToken()}` } });
      const forms = native.session.form;
      const current = listing.parse(await requestBrowser(input.browser_url, "passwords", undefined, context));
      if (current.passwords.length) return JSON.stringify(current);
      const parsed = browserPasswordRequestSchema.safeParse({ website: current.website,
        label: input.label ?? (current.website ? new URL(current.website).hostname : ""), username: input.username ?? "" });
      if (!parsed.success) throw new Error("Open a supported HTTPS website before requesting a saved login.");
      const request = parsed.data;
      const stream = new AbortController();
      const events = native.event.subscribe({ signal: AbortSignal.any([signal, stream.signal]) })[Symbol.asyncIterator]();
      let formID: string | undefined;
      let resolved = false;
      try {
        // Unlike the plugin's live-only stream, native HTTP SSE starts with
        // server.connected. It confirms subscription before form
        // creation. Immediate replies and reloads cannot fall into an SSE gap.
        if ((await events.next()).done) throw new Error("The chat's input connection is unavailable.");
        const form = await forms.create({ sessionID, title: `Save login for ${new URL(request.website).hostname}`,
          metadata: { legalworkBrowserPassword: request }, fields: [
            { key: "password_id", type: "string", hidden: true },
            { key: "cancelled", type: "boolean", hidden: true, default: false },
          ] }, { signal });
        formID = form.id;
        while (true) {
          const detail = await forms.get({ sessionID, formID }, { signal });
          resolved = detail.state.status !== "pending";
          if (detail.state.status === "cancelled") return JSON.stringify({ cancelled: true });
          if (detail.state.status === "answered") {
            const answer = z.object({ password_id: z.string().optional(), cancelled: z.boolean().optional() }).strict().parse(detail.state.answer);
            if (answer.cancelled) return JSON.stringify({ cancelled: true });
            const id = z.string().uuid().parse(answer.password_id);
            await requireBrowserNetwork(context);
            let latest: z.infer<typeof listing>;
            try { latest = listing.parse(await requestBrowser(input.browser_url, "passwords", undefined, context)); }
            catch {
              signal.throwIfAborted();
              // Renderer reloads revoke the old capability. The form and saved
              // entry survive; request a fresh connection, not another password.
              return JSON.stringify({ website: request.website, password_id: id, status: "reconnect_required",
                message: "The card returned a saved-entry reference, but the browser connection changed while waiting. Open the website again to obtain a fresh browser_url, then list matching entries and inspect fresh refs before filling. Do not ask for the password again." });
            }
            const password = latest.passwords.find(item => item.id === id);
            // The desktop applies the vault's main-domain/subdomain matcher.
            if (!password) throw new Error("The browser website or saved login changed. Inspect the current tab before requesting another login.");
            return JSON.stringify({ website: latest.website, passwords: [password] });
          }
          while (true) {
            const event = await events.next();
            if (event.done) throw new Error("The chat's input connection closed. Inspect the request before retrying.");
            if ((event.value.type === "form.replied" || event.value.type === "form.cancelled") && event.value.data.id === formID && event.value.data.sessionID === sessionID) break;
          }
        }
      } finally {
        stream.abort();
        await events.return?.().catch(() => {});
        // Cancellation/Stop must not leave an orphaned credential card.
        if (formID && !resolved) await forms.cancel({ sessionID, formID }).catch(() => {});
      }
    },
  });
}
