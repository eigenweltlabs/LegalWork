// One-time recovery of unchanged installers from build 38701131551.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const builder = createRequire(require.resolve('electron-builder'));
const lib = createRequire(builder.resolve('app-builder-lib'));
const { getPath7za } = builder('app-builder-lib/out/toolsets/7zip.js');
const { buildBlockMap } = builder('app-builder-lib/out/targets/blockmap/blockmap.js');
const { extractFile } = lib('@electron/asar');
const YAML = require('yaml');
const dir = path.resolve('recovered');
const arch = process.env.ALPHA_ARCH;
assert.ok(['arm64', 'x64'].includes(arch));
const version = '0.2.8-alpha.46.g1cd3135';
const name = `legalwork-win-${arch}-${version}.exe`;
const installer = path.join(dir, name);
assert.ok(fs.existsSync(installer), 'Original installer must match the source version and architecture');

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

async function main() {
  if (process.argv[2] === 'extract') {
    const sevenzip = await getPath7za();
    const outer = path.join(dir, 'nsis');
    execFileSync(sevenzip, ['x', installer, `-o${outer}`, '-y'], { stdio: 'inherit' });
    const inner = walk(outer).filter(file => path.basename(file) === (arch === 'arm64' ? 'app-arm64.7z' : 'app-64.7z'));
    assert.equal(inner.length, 1, 'Expected one application archive inside the original installer');
    execFileSync(sevenzip, ['x', inner[0], `-o${path.join(dir, 'app')}`, '-y'], { stdio: 'inherit' });
    const pkg = JSON.parse(extractFile(path.join(dir, 'app/resources/app.asar'), 'package.json').toString());
    assert.equal(pkg.version, version);
    console.log(`Verified original packaged version: ${pkg.version}`);
    return;
  }
  assert.equal(process.argv[2], 'metadata');
  const info = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const manifest = {
    version,
    files: [{ url: name, sha512: info.sha512, size: fs.statSync(installer).size }],
    path: name,
    sha512: info.sha512,
    releaseDate: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, process.env.UPDATER_MANIFEST), YAML.stringify(manifest));
  const url = `https://github.com/eigenweltlabs/legalwork/releases/download/alpha-windows-${arch}-v0.2.8-alpha.46-1cd3135/${name}`;
  manifest.files[0].url = url;
  manifest.path = url;
  fs.mkdirSync(path.join(dir, 'pointer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pointer', process.env.UPDATER_MANIFEST), YAML.stringify(manifest));
  console.log(`Created metadata for unchanged installer: ${name}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
