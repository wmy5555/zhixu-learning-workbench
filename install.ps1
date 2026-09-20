$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
  & $npmCommand.Source install
} else {
  $runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
  $nodePath = Join-Path $runtimeRoot 'bin\node.exe'
  $pnpmPath = Join-Path $runtimeRoot 'node_modules\pnpm\bin\pnpm.cjs'
  if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $pnpmPath)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ first.' }
  & $nodePath $pnpmPath install --frozen-lockfile --store-dir .tmp/pnpm-store
}
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Dependencies installed. Double-click start.cmd.'
