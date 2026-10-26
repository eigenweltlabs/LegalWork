// Build the reviewed engine for CI without publishing releases or borrowing
// credentials from the private migration evidence store.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyReviewedPatch, assertBuildReady, buildCandidate, verifyCompiler, verifyInputs } from "../../packages/opencode-release/build/candidate.mjs";
import { assembleDerivativeDistribution } from "../../packages/opencode-release/build/distribution.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const recipe = JSON.parse(await readFile(path.join(repository, "packages/opencode-release/build/recipe.json"), "utf8"));
const root = process.argv[2];
if (!root || process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Use a new output directory on the recipe's pinned macOS ARM64 builder.");
await verifyInputs(recipe); assertBuildReady(recipe);
await mkdir(root);
async function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${signal ?? code}`)));
  });
}

const compiler = recipe.toolchain.executables["darwin-arm64"];
const response = await fetch(compiler.tarball);
if (!response.ok) throw new Error(`Pinned compiler download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== compiler.integrity) throw new Error("Compiler registry archive integrity differs.");
const archive = path.join(root, "compiler.tgz"), extracted = path.join(root, "compiler");
await writeFile(archive, bytes, { flag: "wx" }); await mkdir(extracted);
await run("tar", ["-xzf", archive, "-C", extracted]);
const bun = path.join(extracted, "package/bin/bun");
verifyCompiler(recipe, await readFile(bun)); await chmod(bun, 0o755);
const prepared = path.join(root, "upstream");
await run("git", ["clone", "--depth=1", "--branch", recipe.upstream.tag, recipe.upstream.repository, prepared]);
await applyReviewedPatch(prepared, path.join(repository, recipe.inputs.patch.path));
// Narrow user-approved exception: retain OpenCode's exact official Bun graph.
await run(bun, ["--no-env-file", "install", "--frozen-lockfile", "--ignore-scripts", "--os=*", "--cpu=*", "--libc=*"], prepared);

const builds = [];
let first;
for (const target of recipe.targets) {
  const output = path.join(root, `build-${target}`);
  const built = await buildCandidate({ output, bun, target, preparedSource: prepared,
    ...(first ? { reuseArtifact: first.artifact, reuseProvenanceSha256: first.provenanceSha256 } : {}) });
  first ??= built;
  builds.push({ target, directory: built.artifact, provenanceSha256: built.provenanceSha256 });
  await writeFile(path.join(output, "result.json"), `${JSON.stringify(built, null, 2)}\n`, { flag: "wx" });
  // The five-file verified artifact and all build receipts remain. Discard
  // duplicate temporary compiler outputs, preserving the first staging tree.
  await rm(path.join(output, "compiled"), { recursive: true });
  if (built !== first) await rm(path.join(output, "source-review"), { recursive: true });
}
const distribution = path.join(root, "distribution"); await mkdir(distribution);
const result = await assembleDerivativeDistribution({ builds, outputDirectory: path.join(distribution, "archives"), manifestPath: path.join(distribution, "derivative-release.json") });
await writeFile(path.join(root, "builds.json"), `${JSON.stringify(builds, null, 2)}\n`, { flag: "wx" });
await writeFile(path.join(distribution, "distribution-receipt.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `manifest-sha256=${result.manifestSha256}\n`);
console.log(JSON.stringify(result));
