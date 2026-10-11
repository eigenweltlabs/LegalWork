/** The bundled native supervisor owns descendant cleanup. Keep error status
 * in the command's own scope because PowerShell resets $? after script blocks. */
export function windowsHostScript(command: string): string {
  const exitStatus = `
$succeeded = $?
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
if (-not $succeeded) { exit 1 }
`;
  return `$ErrorActionPreference = 'Continue'
& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(command + "\n" + exitStatus).toString("base64")}'))))
${exitStatus}`;
}
