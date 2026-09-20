$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = $package.packageManager -replace '^pnpm@', ''
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if ($npxCommand) {
  & $npxCommand.Source --yes "pnpm@$pnpmVersion" install --frozen-lockfile
} else {
  $runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
  $nodePath = Join-Path $runtimeRoot 'bin\node.exe'
  $pnpmPath = Join-Path $runtimeRoot 'node_modules\pnpm\bin\pnpm.cjs'
  if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $pnpmPath)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ first.' }
  $installedVersion = (& $nodePath $pnpmPath --version).Trim()
  if ($installedVersion -ne $pnpmVersion) { throw "Expected pnpm $pnpmVersion. Install Node.js 24 and run install.cmd again." }
  & $nodePath $pnpmPath install --frozen-lockfile --store-dir .tmp/pnpm-store
}
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Dependencies installed. Double-click start.cmd.'
