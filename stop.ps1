$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot '.data\web.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Host 'No launcher-managed service found.'; exit 0 }
$learningProcessId = [int]([IO.File]::ReadAllText($pidPath).Trim())
$learningProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $learningProcessId" -ErrorAction SilentlyContinue
$serverPattern = [regex]::Escape((Join-Path $PSScriptRoot 'src\server.mjs'))
if ($learningProcess -and $learningProcess.Name -eq 'node.exe' -and $learningProcess.CommandLine -match $serverPattern) {
  [Diagnostics.Process]::GetProcessById($learningProcessId).Kill()
  Write-Host 'Learning Workbench stopped. Saved data is retained.'
} elseif ($learningProcess) { throw 'The saved process id belongs to another program; no process was stopped.' }
Remove-Item -LiteralPath $pidPath -Force
