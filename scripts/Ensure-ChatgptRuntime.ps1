param([Parameter(Mandatory=$true)][string]$ConfigPath, [switch]$WaitReady)
$ErrorActionPreference = 'Stop'
$runtimeConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$runtimeModule = Join-Path $PSScriptRoot 'chatgpt-runtime.mjs'
$runtimeConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$runtimeStatusText = & $runtimeConfig.nodePath $runtimeModule $runtimeConfigPath 'status'
$runtimeStatus = $runtimeStatusText | ConvertFrom-Json
if ($runtimeStatus.phase -eq 'unavailable') {
  # The Windows process service creates the detached owner without inheriting
  # the desktop launcher's captured pipes. Only paths are passed, never secrets.
  $runtimeCommand = '"' + $runtimeConfig.nodePath + '" "' + $runtimeModule + '" "' + $runtimeConfigPath + '" run'
  $runtimeStartup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow=[uint16]0 }
  $runtimeCreated = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine=$runtimeCommand; CurrentDirectory=$PSScriptRoot; ProcessStartupInformation=$runtimeStartup }
  if ($runtimeCreated.ReturnValue -ne 0) { throw ('Detached runtime launch failed: ' + $runtimeCreated.ReturnValue) }
}
$runtimeArguments = @($runtimeModule, $runtimeConfigPath, 'status')
if ($WaitReady) { $runtimeArguments += '--wait-ready' }
$runtimeStatusText = & $runtimeConfig.nodePath @runtimeArguments
$runtimeStatus = $runtimeStatusText | ConvertFrom-Json
Write-Output $runtimeStatusText
if ($runtimeStatus.phase -eq 'unavailable') { exit 1 }
exit 0
