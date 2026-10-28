import { Plugin } from "@opencode/plugin";
import { nativeModelCatalogRequestSchema, nativeModelCatalogRpc } from "../native-model-catalog-rpc.js";

/** Read the released engine's own catalog, including inactive providers.
 * Native OpenCode remains responsible for packages, modes and capabilities. */
export const LegalWorkModelCatalog = Plugin.define({
  id: "legalwork.model-catalog",
  async setup(ctx) {
    let inventories = new Map<string, string[]>();
    const source = await ctx.provider.transform(editor => {
      inventories = new Map(editor.list().map(record => [record.provider.id, [...record.models.keys()].sort()]));
    });
    const rpc = await ctx.rpc.register(nativeModelCatalogRpc, {
      async inventory(input) {
        const { providerID } = nativeModelCatalogRequestSchema.parse(input);
        await ctx.provider.list();
        return { models: inventories.get(providerID) ?? [] };
      },
    });
    return async () => { await rpc.dispose(); await source.dispose(); };
  },
});
export default LegalWorkModelCatalog;
