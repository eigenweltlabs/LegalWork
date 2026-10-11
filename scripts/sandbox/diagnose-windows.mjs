import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'legalwork-shell-diagnostic-'));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
const shell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const commands = [
  ['console', "[Console]::WriteLine('native-console')"],
  ['pipeline', "'native-pipeline'"],
  ['echo', "echo native-shell; exit 7"],
  ['explicit-import', "[Console]::Error.WriteLine('before utility import'); Import-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Utility'); [Console]::Error.WriteLine('after utility import'); Write-Output native-import"],
  ['explicit-command', "Microsoft.PowerShell.Utility\\Write-Output native-qualified"],
];
try {
  for (const [name, command] of commands) {
    const script = join(root, `${name}.ps1`);
    await writeFile(script, `[Console]::Error.WriteLine('script started'); [Console]::Error.WriteLine($PSHOME); [Console]::Error.WriteLine($env:PSModulePath);\n${command}\n[Console]::Error.WriteLine('script finished')\n`);
    const start = performance.now();
    await new Promise(resolve => {
      const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const timer = setTimeout(() => { console.log(`${name}: timed out`); child.kill('SIGKILL'); }, 15000);
      child.stdout.on('data', data => console.log(`${name} stdout: ${data}`));
      child.stderr.on('data', data => console.log(`${name} stderr: ${data}`));
      child.on('error', error => console.log(`${name}: ${error}`));
      child.on('close', code => { clearTimeout(timer); console.log(`${name}: exit ${code}, ${Math.round(performance.now() - start)} ms`); resolve(); });
    });
  }
} finally { await rm(root, { recursive: true, force: true }); }
