// Build input in an ephemeral CI checkout. Never modifies user configuration.
import { readFile, writeFile } from "node:fs/promises";
import { verifyDerivativeDistributionContent } from "../../packages/opencode-release/derivative.mjs";
const [manifestPath, manifestSha256] = process.argv.slice(2);
if (!manifestPath || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("A manifest path and independent producer SHA256 are required.");
const manifestContent = await readFile(manifestPath, "utf8");
const verified = await verifyDerivativeDistributionContent({ manifestContent, manifestSha256 });
const selection = { schemaVersion: 1, kind: "derivative", version: verified.version, baseVersion: verified.baseVersion, manifestContent, manifestSha256 };
await writeFile(new URL("../../packages/opencode-release/selection.json", import.meta.url), `${JSON.stringify(selection, null, 2)}\n`);
console.log(`CI selected ${verified.version} with manifest ${manifestSha256}`);
