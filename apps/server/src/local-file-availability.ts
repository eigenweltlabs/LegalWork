import { execFile } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";

export type LocalFileIssue = "online_only" | "failed";

// GetAttributes queries metadata only. Node's Stats omits the Windows Offline
// and RecallOnDataAccess attributes used by Files On-Demand. RecallOnOpen shares
// a bit with EA and is only meaningful in directory enumeration, not this API.
const script = `
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.Encoding]::UTF8
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$paths=ConvertFrom-Json ([Console]::In.ReadToEnd())
$result=[Collections.Generic.List[object]]::new()
foreach ($path in $paths) {
  try {
    $attributes=[int][IO.File]::GetAttributes([string]$path)
    if (($attributes -band 0x401000) -ne 0) { $result.Add(@{path=$path;reason='online_only'}) }
  } catch { $result.Add(@{path=$path;reason='failed'}) }
}
ConvertTo-Json -Compress -Depth 3 -InputObject @($result.ToArray())
`;

const resultSchema = z.array(z.object({ path: z.string(), reason: z.enum(["online_only", "failed"]) }));

/** Background sync must not open placeholders to discover their contents. */
export async function unavailableLocalFiles(paths: string[]): Promise<ReadonlyMap<string, LocalFileIssue>> {
  if (process.platform !== "win32" || paths.length === 0) return new Map();
  const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, output) => error ? reject(error) : resolve(output));
    child.stdin?.end(JSON.stringify(paths));
    child.stdin?.on("error", reject);
  });
  const result = resultSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/, "")));
  const requested = new Set(paths);
  if (result.some(item => !requested.has(item.path))) throw new Error("Unexpected path in Windows file availability response");
  return new Map(result.map(item => [item.path, item.reason]));
}
