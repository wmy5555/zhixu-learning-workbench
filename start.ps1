param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$dataPath = Join-Path $PSScriptRoot '.data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ and try again.' }
$nodeMajor = ((& $nodePath --version).TrimStart('v').Split('.')[0])
if ([int]$nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\yaml'))) { throw 'Dependencies are missing. Run install.cmd first.' }
$readyScript = Join-Path $PSScriptRoot 'scripts\check-ready.mjs'
& $nodePath $readyScript
if ($LASTEXITCODE -eq 0) { if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4318' }; exit 0 }
$serverPath = Join-Path $PSScriptRoot 'src\server.mjs'
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log')
[IO.File]::WriteAllText((Join-Path $dataPath 'web.pid'), [string]$process.Id)
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  if ($process.HasExited) { throw 'The server stopped. See .data/server-error.log.' }
  & $nodePath $readyScript
  if ($LASTEXITCODE -eq 0) { if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4318' }; exit 0 }
}
throw 'Startup timed out. See .data/server-error.log.'
