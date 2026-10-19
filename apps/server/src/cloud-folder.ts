import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";

// Ask for the registered sync root, not a file's hydration flags: fully
// downloaded OneDrive folders must obey the same sharing policy.
const script = `
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class CloudFolder {
  [DllImport("cldapi.dll", CharSet=CharSet.Unicode)]
  public static extern int CfGetSyncRootInfoByPath(string path, int infoClass, out long info, uint length, out uint returned);
}
'@
$path=ConvertFrom-Json ([Console]::In.ReadToEnd())
[long]$info=0
[uint32]$returned=0
$hr=[CloudFolder]::CfGetSyncRootInfoByPath($path,0,[ref]$info,8,[ref]$returned)
if ($hr -eq 0) { 'true' }
# HRESULT_FROM_WIN32: not under a cloud root, file not found, path not found.
elseif ($hr -in @(-2147024506,-2147024894,-2147024893)) { 'false' }
else { [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr) }
`;

export function isMacCloudFolder(path: string, userHome: string): boolean {
  return [posix.join(userHome, "Library", "CloudStorage"), posix.join(userHome, "Library", "Mobile Documents", "com~apple~CloudDocs")]
    .some(root => path === root || path.startsWith(root + posix.sep));
}

/** Metadata only; never enumerate or open the folder's documents. */
export async function isCloudFolder(path: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return isMacCloudFolder(resolve(path), homedir()) || isMacCloudFolder(await realpath(path).catch(() => resolve(path)), homedir());
  }
  if (process.platform !== "win32") return false;
  const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const stdout = await new Promise<string>((resolveOutput, reject) => {
    const child = execFile(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15_000, encoding: "utf8" },
      (error, output) => error ? reject(error) : resolveOutput(output));
    child.stdin?.on("error", reject);
    child.stdin?.end(JSON.stringify(path));
  });
  const result = stdout.trim();
  if (result !== "true" && result !== "false") throw new Error("Unexpected Windows cloud folder response");
  return result === "true";
}
