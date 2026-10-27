// Build/development entry only. Runtime consumers import the fixed selector.
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import recipe from "./build/recipe.json" with { type: "json" };
import { prepareOpencodeEngine, checkPreparedOpencodeEngine } from "./build/prepare.mjs";

export function engineBuildMode(args, fallback = "development") {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--engine-mode") values.push(args[++i]);
    else if (args[i].startsWith("--engine-mode=")) values.push(args[i].slice(14));
  }
  if (values.length > 1 || values.length && !["development", "production"].includes(values[0])) {
    throw new Error("Supply one explicit --engine-mode development or production.");
  }
  const mode = values[0] ?? fallback;
  if (!["development", "production"].includes(mode)) throw new Error("An explicit engine build mode is required.");
  return mode;
}

export async function prepareForBuild({ mode, targets, checkOnly = false, ...options }, implementation = { prepareOpencodeEngine, checkPreparedOpencodeEngine }) {
  if (!["development", "production"].includes(mode)) throw new Error("An explicit engine build mode is required.");
  const input = { ...options, mode, ...(targets ? { targets } : mode === "production" ? { targets: recipe.targets } : {}) };
  try {
    return await implementation[checkOnly ? "checkPreparedOpencodeEngine" : "prepareOpencodeEngine"](input);
  } catch (cause) {
    throw new Error(`OpenCode ${mode} ${checkOnly ? "preparation check" : "build preparation"} failed. Run pnpm engine:prepare${mode === "production" ? ":production" : ""} with the reviewed compiler/signing inputs before starting or packaging. ${cause.message}`, { cause });
  }
}

export async function preparationCli(args) {
  let mode, checkOnly = false, all = false, macSigningPath;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--") continue;
    if (argument === "--mode") {
      if (mode !== undefined) throw new Error("Only one --mode is allowed.");
      mode = args[++i];
    } else if (argument === "--check") checkOnly = true;
    else if (argument === "--all-targets") all = true;
    else if (argument === "--target") targets.push(args[++i]);
    else if (argument === "--mac-signing-config") {
      if (macSigningPath) throw new Error("Only one signing configuration is allowed.");
      macSigningPath = args[++i];
      if (!macSigningPath || macSigningPath.startsWith("--")) throw new Error("--mac-signing-config requires an explicit build policy file.");
    } else throw new Error(`Unknown engine preparation argument: ${argument}`);
  }
  if (all && targets.length || targets.some(target => !recipe.targets.includes(target)) || new Set(targets).size !== targets.length) {
    throw new Error("Use --all-targets or distinct reviewed --target values.");
  }
  if (checkOnly && macSigningPath) throw new Error("A check-only start cannot change signing configuration.");
  return prepareForBuild({ mode, checkOnly, ...(all ? { targets: recipe.targets } : targets.length ? { targets } : {}),
    ...(macSigningPath ? { macSigning: JSON.parse(await readFile(macSigningPath, "utf8")) } : {}) });
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try { console.log(JSON.stringify(await preparationCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
