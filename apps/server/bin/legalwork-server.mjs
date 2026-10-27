#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

const binaryName = process.platform === "win32" ? "legalwork-server.exe" : "legalwork-server";
const compiledBinary = fileURLToPath(new URL(`./dist/bin/${binaryName}`, `${new URL("../", import.meta.url)}`));
const builtCli = fileURLToPath(new URL("./dist/cli.js", `${new URL("../", import.meta.url)}`));
const sourceCli = fileURLToPath(new URL("./src/cli.ts", `${new URL("../", import.meta.url)}`));

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(`Missing runtime dependency: ${command}`);
      process.exit(1);
    }
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

if (existsSync(compiledBinary)) {
  run(compiledBinary, args);
}

// Source checkouts must already have a current prepared selector. Published
// compiled binaries retain their own immutable pins and do not load build code.
if (existsSync(sourceCli)) {
  const check = spawnSync(process.execPath, [
    resolve(packageRoot, "../../packages/opencode-release/prepare.mjs"),
    "--mode", "development", "--check",
  ], { stdio: "inherit" });
  if (check.status !== 0) process.exit(check.status ?? 1);
}

if (existsSync(builtCli)) {
  run(process.execPath, [builtCli, ...args]);
}

if (existsSync(sourceCli)) {
  run("bun", [sourceCli, ...args]);
}

console.error(
  `Unable to find a LegalWork server entrypoint in ${basename(packageRoot)}. Build the package or run it from a source checkout with Bun available.`,
);
process.exit(1);
