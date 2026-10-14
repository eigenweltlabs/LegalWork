// Refresh pinned OpenUI notices with pnpm exec node apps/app/scripts/openui-license-notices.mjs.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["@openuidev/react-lang", "@openuidev/react-ui", "@openuidev/react-headless"];
const openui = resolve(app, "../../packages/openui");
const visited = new Set();
const entries = [];
function visit(name, from) {
  const require = createRequire(join(from, "package.json"));
  const candidate = (require.resolve.paths("legalwork-license-lookup") ?? []).map((directory) => join(directory, name, "package.json")).find(existsSync);
  if (!candidate) throw new Error(`Cannot resolve ${name}`);
  const file = realpathSync(candidate);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return;
  visited.add(key);
  const directory = dirname(file);
  const notices = readdirSync(directory).filter((name) => /^(licen[cs]e|notice|copying)([.-]|$)/i.test(name));
  const texts = notices.map((name) => `${name}\n${readFileSync(join(directory, name), "utf8")}`).join("\n\n");
  const license = pkg.license ?? pkg.licenses?.map((entry) => entry.type).join(" OR ") ?? (pkg.name === "@ag-ui/core" && pkg.version === "0.0.53" && texts.startsWith("LICENSE\nMIT License\n") ? "MIT (LICENSE file)" : undefined);
  if (!license) throw new Error(`Review the license of ${key} before distributing.`);
  entries.push({ key, license, text: texts || `License declaration: ${JSON.stringify(license)}. Source: ${JSON.stringify(pkg.repository ?? pkg.homepage ?? "")}` });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, directory);
}
for (const name of roots) visit(name, openui);
entries.sort((a, b) => a.key.localeCompare(b.key));
const text = "LegalWork OpenUI dependency licenses and notices\nGenerated from the pinned installed dependency tree. Dependencies retain their original licenses.\nFor dual-licensed dependencies offering MIT, this distribution uses the MIT option.\n\n" + entries.map((entry) => `===== ${entry.key} (${JSON.stringify(entry.license)}) =====\n${entry.text}`).join("\n\n");
writeFileSync(join(app, "public/third-party/openui/DEPENDENCY_LICENSES.txt"), text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, ""));
console.log(`${entries.length} packages; licenses: ${[...new Set(entries.map((entry) => JSON.stringify(entry.license)))].join(", ")}`);
