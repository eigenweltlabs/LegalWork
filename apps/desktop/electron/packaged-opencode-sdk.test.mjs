import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpencodeSdk } from "../scripts/prepare-opencode-sdk.mjs";
import { parse } from "yaml";

test("packaging excludes stale Anthropic auth output while retaining API inference plugins", async () => {
  const require = createRequire(import.meta.url);
  const { FileMatcher } = createRequire(require.resolve("electron-builder"))("app-builder-lib/out/fileMatcher.js");
  const config = parse(await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  const root = await mkdtemp(join(tmpdir(), "retired-auth-package-"));
  try {
    const resource = config.extraResources.find((entry) => entry.to === "opencode-plugins");
    const directory = join(root, resource.from);
    await mkdir(directory, { recursive: true });
    const inAsar = new FileMatcher(root, join(root, "asar"), (value) => value, config.files).createFilter();
    const inResources = new FileMatcher(directory, join(root, "resources"), (value) => value, resource.filter).createFilter();
    for (const name of ["legalwork-anthropic-auth", "legalwork-anthropic-adaptive-thinking", "legalwork-anthropic-tool-schema"]) {
      const file = join(directory, `${name}.js`);
      await writeFile(file, "export default {};\n");
      const info = await stat(file);
      assert.equal(inAsar(file, info), false, "plugins must stay outside the ASAR");
      assert.equal(inResources(file, info), name !== "legalwork-anthropic-auth", name);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("desktop packaging includes license texts for the bundled browser plugin and SDK", async () => {
  const config = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(config, /- from: resources\/licenses\s+to: licenses/);
  const notices = await readFile(new URL("../resources/licenses/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8");
  const apache = await readFile(new URL("../resources/licenses/Apache-2.0.txt", import.meta.url), "utf8");
  const serverPackage = JSON.parse(await readFile(new URL("../../server/package.json", import.meta.url), "utf8"));
  for (const name of ["opencode-chrome-devtools", "@opencode-ai/plugin"])
    assert.ok(notices.includes(`${name} ${serverPackage.devDependencies[name]}`), `License notice needs ${name}'s pinned version`);
  for (const notice of ["Copyright (c) 2025 opencode", "Copyright (c) 2025 Colin McDonnell", "Copyright (c) 2011 Einar Otto Stangvik", "kubernetes-types 1.30.0"])
    assert.ok(notices.includes(notice), `Missing bundled dependency attribution: ${notice}`);
  assert.match(apache, /Apache License/);
  assert.match(apache, /END OF TERMS AND CONDITIONS/);
});

test("SDK staging copies real dependencies without optional native packages and rejects a drifting engine version", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-stage-"));
  const source = join(root, "source"), dependency = join(source, "node_modules", "fixture-dependency"), output = join(root, "output");
  try {
    await mkdir(dependency, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "@opencode-ai/plugin", version: "1.18.29", dependencies: { "fixture-dependency": "1.0.0" }, optionalDependencies: { "native-acceleration": "1.0.0" } }));
    await writeFile(join(source, "index.js"), "export const plugin = true;\n");
    await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "fixture-dependency", version: "1.0.0" }));
    await writeFile(join(dependency, "index.js"), "export const dependency = true;\n");
    await writeFile(join(dependency, "LICENSE"), "Fixture license notice\n");
    assert.deepEqual(await stageOpencodeSdk({ sourcePackage: source, destination: output, expectedVersion: "1.18.29" }), { version: "1.18.29", packages: 2 });
    assert.equal(await readFile(join(output, "node_modules", "fixture-dependency", "index.js"), "utf8"), "export const dependency = true;\n");
    assert.equal(await readFile(join(output, "node_modules", "fixture-dependency", "LICENSE"), "utf8"), "Fixture license notice\n");
    await assert.rejects(readFile(join(output, "node_modules", "@opencode-ai/plugin", "node_modules", "fixture-dependency", "index.js")), { code: "ENOENT" });
    await assert.rejects(stageOpencodeSdk({ sourcePackage: source, destination: output, expectedVersion: "1.18.30" }), /must match engine/);
    assert.equal(JSON.parse(await readFile(join(output, "package.json"), "utf8")).dependencies["@opencode-ai/plugin"], "1.18.29");
  } finally { await rm(root, { recursive: true, force: true }); }
});
