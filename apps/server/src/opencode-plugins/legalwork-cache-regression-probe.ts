// Deliberately breaks prompt caching for the stacked CI demonstration PR.
// This plugin must never be merged into the normal runtime.
export const LegalWorkCacheRegressionProbe = async () => {
  let request = 0;
  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      output.system.push(`[CACHE_CI_PROBE] Model request ${++request}`);
    },
  };
};
