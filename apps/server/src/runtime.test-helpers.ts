import { resetOrgPolicyRuntimeForTests } from "./org-policy.js";
import { closeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

/** Windows cannot unlink databases still held by a test's policy/config caches. */
export async function closeTestRuntime(config: ServerConfig) {
  await resetOrgPolicyRuntimeForTests(config);
  await closeRuntimeOpencodeConfig(config);
}
