import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";

const run = promisify(execFile);
export const OPEN_COMPUTER_USE_VERSION = "1.1.0";
const RELEASE_URL = `https://github.com/iFurySt/open-codex-computer-use/releases/download/v${OPEN_COMPUTER_USE_VERSION}`;

/** Select an upstream release, including its pinned GitHub asset digest. */
export function openComputerUseRelease(platform, arch) {
  if (arch !== "arm64" && arch !== "x64") throw new Error("Open Computer Use requires an Intel or ARM64 computer.");
  if (platform === "darwin") {
    return {
      name: "Open-Computer-Use-1.1.0-macOS-universal.app.zip",
      sha256: "5d37a1d760c37553dcecb3b505a8c8b36bfc389de4d46498cbcf6e6c88e7eb1a",
      executable: path.join("Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"),
    };
  }
  if (platform === "win32") {
    return {
      name: `open-computer-use-cli-1.1.0-windows-${arch === "arm64" ? "arm64" : "amd64"}.zip`,
      sha256: arch === "arm64"
        ? "723f37b8805ba03ab87b5d7305e06998f82a24cf64b44414a7578f9ddab0cea1"
        : "0ca3c940dc7d1467b70a0a6f95d04974120b5225d2f8174fdbc8df5099270acb",
      executable: "open-computer-use.exe",
    };
  }
  throw new Error("Open Computer Use is available in LegalWork Desktop on Mac and Windows.");
}

async function fetchRelease(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Could not download Open Computer Use (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function extractOpenComputerUseRelease(archivePath, destination, platform) {
  if (platform === "darwin") {
    // ditto preserves the signed app bundle's executable modes and metadata.
    await run("/usr/bin/ditto", ["-x", "-k", archivePath, destination], { timeout: 30_000 });
    return;
  }
  // The Windows release contains one self-contained executable. Extract only
  // that exact member, never archive-controlled paths or a shell command.
  const files = unzipSync(await readFile(archivePath));
  const executable = files["open-computer-use.exe"];
  if (!executable) throw new Error("The Open Computer Use archive is missing its Windows runtime.");
  await writeFile(path.join(destination, "open-computer-use.exe"), executable);
}

async function readDoctor(binary, environment) {
  const { stdout } = await run(binary, ["doctor", "--json"], {
    env: { ...process.env, ...environment },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(String(stdout));
}

/**
 * @param {{
 *   getDataDir: () => string,
 *   platform?: string,
 *   arch?: string,
 *   download?: (url: string) => Promise<Uint8Array>,
 *   extract?: (archive: string, destination: string, platform: string) => Promise<void>,
 *   doctor?: (binary: string, environment: Record<string, string>) => Promise<unknown>
 * }} options
 */
export function createOpenComputerUseIntegration({
  getDataDir,
  platform = process.platform,
  arch = process.arch,
  download = fetchRelease,
  extract = extractOpenComputerUseRelease,
  doctor = readDoctor,
}) {
  /** @type {Promise<string> | undefined} */
  let installing;

  function runtimePaths() {
    const release = openComputerUseRelease(platform, arch);
    const root = path.join(getDataDir(), "integrations", "open-computer-use");
    const directory = path.join(root, `${OPEN_COMPUTER_USE_VERSION}-${platform}-${arch}`);
    return { release, root, directory, binary: path.join(directory, release.executable) };
  }

  function environment() {
    // Keep the upstream macOS agent separate from other MCP clients and from
    // LegalWork's existing computer-use helper, including dev installations.
    const namespace = createHash("sha256").update(getDataDir()).digest("hex").slice(0, 12);
    return { OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE: `legalwork-${namespace}-ocu-${OPEN_COMPUTER_USE_VERSION}` };
  }

  async function install() {
    const { release, root, directory, binary } = runtimePaths();
    if (existsSync(binary)) return binary;
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(path.join(root, ".install-"));
    try {
      const archive = await download(`${RELEASE_URL}/${release.name}`);
      if (createHash("sha256").update(archive).digest("hex") !== release.sha256) {
        throw new Error("Open Computer Use download failed its integrity check. Please try again.");
      }
      const archivePath = path.join(staging, "release.zip");
      const extracted = path.join(staging, "runtime");
      await writeFile(archivePath, archive);
      await mkdir(extracted);
      await extract(archivePath, extracted, platform);
      if (!existsSync(path.join(extracted, release.executable))) {
        throw new Error("The Open Computer Use archive is missing its runtime.");
      }
      // A failed/partial install never becomes the configured MCP command.
      await rm(directory, { recursive: true, force: true });
      await rename(extracted, directory);
      return binary;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  function ensureInstalled() {
    installing ??= install().finally(() => { installing = undefined; });
    return installing;
  }

  /** @returns {Promise<import("@legalwork/types/desktop-ipc").OpenComputerUseStatus>} */
  async function status() {
    const { binary } = runtimePaths();
    const installed = existsSync(binary);
    const result = { version: OPEN_COMPUTER_USE_VERSION, platform, installed, ready: installed };
    if (!installed || platform !== "darwin") return result;
    try {
      const permissions = await doctor(binary, environment());
      if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        throw new Error("Open Computer Use returned an unreadable permission status.");
      }
      const accessibility = "accessibilityTrusted" in permissions && permissions.accessibilityTrusted === true;
      const screenRecording = "screenCaptureGranted" in permissions && permissions.screenCaptureGranted === true;
      return { ...result, ready: accessibility && screenRecording, accessibility, screenRecording };
    } catch (error) {
      return { ...result, ready: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function openPermissionSetup() {
    if (platform !== "darwin") return;
    const binary = await ensureInstalled();
    await new Promise((resolve, reject) => {
      const child = spawn(binary, ["doctor"], {
        env: { ...process.env, ...environment() },
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(undefined); });
    });
  }

  return {
    status,
    openPermissionSetup,
    async mcpConfig() {
      return { command: [await ensureInstalled(), "mcp"], environment: environment() };
    },
  };
}
