import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpencodeSdk } from "../scripts/prepare-opencode-sdk.mjs";

test("desktop packaging includes license texts for both bundled plugins and the SDK", async () => {
  const config = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(config, /- from: resources\/licenses\s+to: licenses/);
  const notices = await readFile(new URL("../resources/licenses/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8");
  const apache = await readFile(new URL("../resources/licenses/Apache-2.0.txt", import.meta.url), "utf8");
  const serverPackage = JSON.parse(await readFile(new URL("../../server/package.json", import.meta.url), "utf8"));
  for (const name of ["opencode-chrome-devtools", "opencode-anthropic-auth", "@opencode-ai/plugin"])
    assert.ok(notices.includes(`${name} ${serverPackage.devDependencies[name]}`), `License notice needs ${name}'s pinned version`);
  for (const notice of ["Copyright (c) 2025 SST", "Copyright (c) 2025 opencode", "Copyright (c) 2024 SST", "Copyright (c) 2018 Filip Skokan", "Copyright (c) 2025 Colin McDonnell", "Copyright (c) 2011 Einar Otto Stangvik", "kubernetes-types 1.30.0"])
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
