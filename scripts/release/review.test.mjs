import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { opencodeEngineSelection } from "../../packages/opencode-release/selection.mjs";
import { writeFixtureDerivativeDistribution, writeFixtureReleaseLibrary } from "../../packages/opencode-release/test-fixture.mjs";

const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
const run = script => {
  const child = spawnSync(process.execPath, [script, "--json", "--strict"], { encoding: "utf8" });
  return { child, report: child.stdout ? JSON.parse(child.stdout) : undefined };
};

test("the source release report separates selected engine identity from its base ABI", () => {
  const { child, report } = run(path.join(sourceRoot, "scripts", "release", "review.mjs"));
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.versions.opencode, opencodeEngineSelection.version);
  assert.equal(report.versions.opencodeKind, opencodeEngineSelection.kind);
  assert.equal(report.versions.opencodeBaseVersion, opencodeEngineSelection.baseVersion);
  if (opencodeEngineSelection.kind === "official") assert.equal(report.versions.opencodeManifestSha256, null);
  assert.ok(report.checks.some(check => check.label === "OpenCode version pin exists" && check.ok));
});

for (const mismatchedPin of [false, true]) test(mismatchedPin ? "release review rejects a changed derivative manifest against the independent pin" : "an isolated derivative selector reports its actual version, base ABI, and verified manifest pin", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-release-review-"));
  try {
    const distributionRoot = path.join(root, "distribution"); await mkdir(distributionRoot);
    const { selection } = await writeFixtureDerivativeDistribution(distributionRoot);
    await writeFixtureReleaseLibrary(path.join(root, "packages", "opencode-release"), mismatchedPin ? { ...selection, manifestContent: `${selection.manifestContent} ` } : selection);
    for (const file of ["constants.json", "scripts/release/review.mjs", ...["app", "desktop", "server", "orchestrator"].map(app => `apps/${app}/package.json`)]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await copyFile(path.join(sourceRoot, file), path.join(root, file));
    }
    const { child, report } = run(path.join(root, "scripts", "release", "review.mjs"));
    assert.equal(child.status, mismatchedPin ? 1 : 0, child.stderr || child.stdout);
    assert.equal(report.ok, !mismatchedPin);
    assert.equal(report.versions.opencode, selection.version);
    assert.equal(report.versions.opencodeKind, "derivative");
    assert.equal(report.versions.opencodeBaseVersion, selection.baseVersion);
    assert.equal(report.versions.opencodeManifestSha256, selection.manifestSha256);
    const pinCheck = report.checks.find(check => check.label === "OpenCode derivative manifest matches its independent pin and selection");
    assert.equal(pinCheck.ok, !mismatchedPin);
    if (mismatchedPin) assert.match(pinCheck.details, /independent build pin/);
    for (const field of ["app", "desktop", "server", "orchestrator", "orchestratorLegalworkServerRange"]) assert.ok(Object.hasOwn(report.versions, field));
    for (const field of ["opencodeRouter", "opencodeRouterVersionPinned"]) assert.equal(Object.hasOwn(report.versions, field), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
