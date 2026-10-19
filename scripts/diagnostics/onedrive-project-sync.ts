import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syncProjectFiles, type FileBase, type FileBaseStore } from "../../apps/server/src/project-file-sync.js";
import type { StorageAdapter } from "../../apps/server/src/file-storage/common.js";
import { unavailableLocalFiles } from "../../apps/server/src/local-file-availability.js";

const root = process.env.ONEDRIVE_PROBE_ROOT;
if (!root || process.platform !== "win32") throw new Error("Run in the isolated Windows probe directory");
const events: Array<{ event: string; file?: string; image?: string; pid?: number }> = [];
const folder = join(root, `cloud-${Date.now()}`);
const helper = spawn(process.env.CLOUD_FILES_FIXTURE_BIN ?? join(root, "cloud-files-fixture.exe"), [folder], { stdio: ["pipe", "pipe", "pipe"] });
let output = "";
let errors = "";
helper.stderr.on("data", chunk => { errors += String(chunk); });
helper.stdout.on("data", chunk => {
  output += String(chunk);
  let end;
  while ((end = output.indexOf("\n")) >= 0) {
    const line = output.slice(0, end).trim(); output = output.slice(end + 1);
    if (line) events.push(JSON.parse(line));
  }
});
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    if (helper.exitCode !== null) throw new Error(`Provider exited: ${errors}`);
    await pause(100);
  }
  throw new Error(`Provider timeout: ${errors}`);
}
const count = () => events.filter(event => event.event === "hydrate").length;
async function measure(name: string, action: () => Promise<unknown>) {
  const before = count();
  const progress = async (phase: string) => { try { await fetch("http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/onedrive/stage", { method: "PUT", headers: { "Metadata-Flavor": "Google" }, body: JSON.stringify({ name, phase, events }) }); } catch {} };
  await progress("start");
  const result = await action();
  await pause(500);
  const hydration = events.filter(event => event.event === "hydrate").slice(before);
  console.log(JSON.stringify({ name, hydrationRequests: hydration.length, files: [...new Set(hydration.map(item => item.file))], processes: [...new Set(hydration.map(item => item.image))], result }));
  await progress("end");
}
async function dehydrate() {
  const before = events.filter(event => event.event === "dehydrated").length;
  helper.stdin.write("dehydrate\n");
  await until(() => events.filter(event => event.event === "dehydrated").length > before);
}
const files = new Map<string, { bytes: Buffer; sha: string }>();
const base = new Map<string, FileBase>();
const baseStore: FileBaseStore = {
  entries: () => new Map(base), put: (key, value) => { base.set(key, value); }, drop: key => { base.delete(key); },
};
const remote: StorageAdapter = {
  list: async () => ({ entries: [] }),
  listFiles: async () => ({ entries: [...files.entries()].map(([path, value]) => ({ path, name: path, kind: "file", size: value.bytes.length, modifiedAt: null, version: value.sha })) }),
  stat: async path => { const file = files.get(path); return file ? { size: file.bytes.length, version: file.sha } : null; },
  upload: async (path, source) => { const bytes = await readFile(source); files.set(path, { bytes, sha: createHash("sha256").update(bytes).digest("hex") }); },
  download: async (path, destination) => { const file = files.get(path); if (!file || !destination) throw new Error("Unavailable fixture"); await writeFile(destination, file.bytes); return { size: file.bytes.length, version: file.sha, sha256: file.sha }; },
  read: async () => { throw new Error("Not used"); }, write: async () => {}, mkdir: async () => {}, deleteFile: async path => { files.delete(path); },
};
const sync = () => syncProjectFiles({ root: folder, remote, base: baseStore, includes: () => true, reconcile: true, settleMs: 0, label: "Synthetic test", maxFileBytes: 256 * 1024 * 1024, allowDeletions: false });
try {
  await until(() => events.some(event => event.event === "ready"));
  console.log(JSON.stringify({ name: "runtime", versions: process.versions }));
  const describeFiles = async () => Promise.all((await readdir(folder, { withFileTypes: true })).map(async file => ({ name: file.name, isFile: file.isFile(), isDirectory: file.isDirectory(), isSymbolicLink: file.isSymbolicLink(), statFile: (await stat(join(folder, file.name))).isFile() })));
  console.log(JSON.stringify({ name: "initial-dirents", files: await describeFiles() }));
  await measure("metadata-enumeration", async () => { for (const file of await readdir(folder)) await stat(join(folder, file)); });
  await measure("metadata-realpath", async () => { for (const file of await readdir(folder)) await realpath(join(folder, file)); });
  await measure("windows-cloud-attributes", async () => {
    const paths = (await readdir(folder)).map(file => join(folder, file));
    const script = `[Console]::InputEncoding=[Text.Encoding]::UTF8; $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); ConvertTo-Json -Compress -InputObject @($paths | ForEach-Object { @{path=$_; attributes=[int][IO.File]::GetAttributes($_)} })`;
    return await new Promise((resolve, reject) => {
      const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)));
      child.stdin?.end(JSON.stringify(paths));
    });
  });
  await measure("background-file-availability", async () => [...await unavailableLocalFiles((await readdir(folder)).map(file => join(folder, file)))]);
  if (process.env.OPENCODE_PROBE_BIN) {
    const engine = spawn(process.env.OPENCODE_PROBE_BIN, ["serve", "--hostname", "127.0.0.1", "--port", "47891"], {
      cwd: folder,
      env: { ...process.env, XDG_DATA_HOME: join(root, "engine-data"), XDG_CONFIG_HOME: join(root, "engine-config"), XDG_CACHE_HOME: join(root, "engine-cache"), OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_LSP_DOWNLOAD: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let engineOutput = "";
    engine.stdout.on("data", chunk => { engineOutput += String(chunk); });
    engine.stderr.on("data", chunk => { engineOutput += String(chunk); });
    try {
      await measure("engine-start-and-project-open", async () => {
        for (let n = 0; n < 100 && !engineOutput.includes("listening"); n++) { if (engine.exitCode !== null) throw new Error(engineOutput); await pause(200); }
        const results = [];
        for (const path of ["/path", "/session", "/file?path=", "/find/file?query=document"]) {
          const url = new URL(path, "http://127.0.0.1:47891"); url.searchParams.set("directory", folder);
          const response = await fetch(url); results.push({ path, status: response.status, bytes: (await response.text()).length });
        }
        await pause(3000);
        return { results, engineOutput };
      });
    } finally {
      engine.kill();
      await Promise.race([new Promise(resolve => engine.once("exit", resolve)), pause(5000)]);
      console.log(JSON.stringify({ name: "engine-output", output: engineOutput }));
    }
  } else {
  await measure("explicit-one-file-read", async () => { await readFile(join(folder, "document-00.txt")); });
  await dehydrate();
  console.log(JSON.stringify({ name: "dehydrated-dirents", files: await describeFiles() }));
  await measure("oversized-files-sync", () => syncProjectFiles({ root: folder, remote, base: baseStore, includes: () => true, reconcile: true, settleMs: 0, label: "Synthetic test", maxFileBytes: 1, allowDeletions: false }));
  await dehydrate();
  await measure("initial-project-sync", sync);
  const initialMetadata = [...base.values()];
  await dehydrate();
  const afterEviction = await Promise.all(initialMetadata.map(async file => ({ path: file.path, savedMtime: file.mtimeMs, evictedMtime: (await stat(join(folder, file.path))).mtimeMs })));
  console.log(JSON.stringify({ name: "eviction-metadata", changed: afterEviction.filter(file => file.savedMtime !== file.evictedMtime).length, first: afterEviction[0] }));
  await measure("unchanged-sync-after-eviction", sync);
  // Restore the base from disk, as a restarted process would.
  await writeFile(join(root, "base.json"), JSON.stringify([...base]));
  base.clear();
  for (const [key, value] of JSON.parse(await readFile(join(root, "base.json"), "utf8"))) base.set(key, value);
  await measure("restarted-sync-with-saved-base", sync);
  await measure("explicit-read-after-sync", async () => { await readFile(join(folder, "document-01.txt")); });
  await measure("sync-explicitly-downloaded-file", sync);
  // A provider/editor may preserve bytes while updating modification times.
  // Check whether the sync baseline advances after verifying identical hashes.
  for (const file of initialMetadata) await utimes(join(folder, file.path), new Date(), new Date(Date.now() - 60_000));
  await measure("unchanged-bytes-new-mtime", sync);
  await dehydrate();
  await measure("next-round-after-new-mtime", sync);
  }
} catch (error) {
  console.log(JSON.stringify({ name: "probe-error", message: error instanceof Error ? error.stack : String(error) }));
  process.exitCode = 1;
} finally {
  helper.stdin.end("stop\n");
  await Promise.race([new Promise(resolve => helper.once("exit", resolve)), pause(5000)]);
  helper.kill();
  if (errors) console.log(JSON.stringify({ name: "provider-errors", errors }));
  console.log(JSON.stringify({ name: "provider-events", events }));
  await mkdir(join(root, "results"), { recursive: true });
  await writeFile(join(root, "results", "events.json"), JSON.stringify(events, null, 2));
}
