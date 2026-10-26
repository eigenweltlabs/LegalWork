import { Plugin } from "@opencode/plugin";
import { ManagedSettingsWorkspaceMissingError, managedSettingsRpc, readManagedEngineSettings } from "../managed-engine-settings.js";
import { registerPrimaryContext } from "./native-review-worker.js";

/** Compatibility only: native configuration owns definitions and discovery.
 * Explicit legacy model filters and generation options have no Config equivalent. */
export const LegalWorkManagedConfig = Plugin.define({
  id: "legalwork.managed-config",
  async setup(ctx) {
    const settingsPath = ctx.options.settingsPath;
    if (typeof settingsPath !== "string") throw new Error("LegalWork managed settings path is required");
    const read = async () => {
      try { return await readManagedEngineSettings(settingsPath, ctx.location.directory); }
      catch (error) { if (error instanceof ManagedSettingsWorkspaceMissingError) return undefined; throw error; }
    };
    let settings = await read();
    const excluded = (providerID: string, modelID: string) => {
      const filter = settings?.modelFilters[providerID];
      return Boolean(filter && (filter.allow && !filter.allow.includes(modelID) || filter.deny?.includes(modelID)));
    };
    const registrations: Array<{ dispose(): Promise<void> }> = [];
    registrations.push(await ctx.model.transform(editor => {
      for (const model of editor.list()) if (excluded(model.providerID, model.id)) editor.remove(model.providerID, model.id);
    }));
    registrations.push(await ctx.session.hook("model.request", event => {
      if (excluded(event.model.providerID, event.model.id) || settings?.providerActivation[event.model.providerID] === "deny") {
        throw new Error("This model is disabled by the saved LegalWork provider selection.");
      }
    }));
    registrations.push(await registerPrimaryContext(ctx, event => {
      const request = settings?.agentRequests[event.agent];
      if (request) Object.assign(event.options, request);
    }));
    registrations.push(await ctx.rpc.register(managedSettingsRpc, { async refresh() {
      settings = await read();
      await ctx.model.reload();
      return { refreshed: true };
    } }));
    return async () => { for (const registration of registrations.reverse()) await registration.dispose(); };
  },
});
export default LegalWorkManagedConfig;
