param(
  [Parameter(Mandatory=$true)][string]$FormalLauncherPath,
  [Parameter(Mandatory=$true)][string]$PreviousRuntimeConfig
)
$ErrorActionPreference = 'Stop'
$FormalLauncherPath = [IO.Path]::GetFullPath($FormalLauncherPath)
$formalConfigPath = Join-Path (Split-Path -Parent $FormalLauncherPath) 'config.json'
$formal = Get-Content -LiteralPath $formalConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$previous = Get-Content -LiteralPath $PreviousRuntimeConfig -Raw -Encoding UTF8 | ConvertFrom-Json
if ($formal.port -ne 4318 -or $previous.port -ne 4318 -or $previous.mockTunnel -or $previous.mode -ne 'production') { throw 'Expected the existing formal 4318 runtime.' }
if ([IO.Path]::GetFullPath($formal.dataDir) -ne [IO.Path]::GetFullPath($previous.dataRoot)) { throw 'Existing runtime data references differ.' }
foreach ($required in @($previous.nodePath, $previous.tunnelClientPath, $previous.profileFile, $previous.credentialEnvFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Existing runtime dependency is missing.' }
}
$task = Get-ScheduledTask -TaskName 'Zhixu ChatGPT AutoStart'
if ($task.State -eq 'Running') { throw 'Existing autostart task is running; refusing to replace an active owner.' }
$installRoot = Join-Path $previous.workRoot '.env.zhixu-plugin-runtime'
$kit = Join-Path $installRoot 'kit'
$state = Join-Path $installRoot 'state'
$rollback = Join-Path $installRoot ('rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $kit, $state, $rollback -Force | Out-Null
Copy-Item -LiteralPath $FormalLauncherPath -Destination (Join-Path $rollback 'Start-Formal4318.ps1')
Export-ScheduledTask -TaskName $task.TaskName | Set-Content -LiteralPath (Join-Path $rollback 'autostart.xml') -Encoding UTF8
foreach ($name in @('chatgpt-runtime.mjs', 'Ensure-ChatgptRuntime.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $kit $name) -Force
}
$config = [ordered]@{
  schemaVersion=1; formalConfigPath=$formalConfigPath; formalLauncherPath=$FormalLauncherPath
  stateRoot=$state; nodePath=$previous.nodePath; tunnelClientPath=$previous.tunnelClientPath
  profileFile=$previous.profileFile; credentialEnvFile=$previous.credentialEnvFile
  credentialEnvName=$previous.credentialEnvName; powershellPath=$previous.powershellPath; pollMs=10000
}
$configPath = Join-Path $installRoot 'runtime.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$source = [IO.File]::ReadAllText($FormalLauncherPath)
if ($source.Contains('Ensure-ChatgptRuntime.ps1')) { throw 'Formal launcher is already integrated; inspect its current runtime before reinstalling.' }
$anchor = '@{ sourceSha=$config.sourceSha; tree=$config.sourceTree;'
if (-not $source.Contains($anchor)) { throw 'Formal launcher format changed; refusing a guessed patch.' }
$hook = @'
$pluginRuntimeConfig = '__RUNTIME_CONFIG__'
$pluginRuntimeEntry = '__RUNTIME_ENTRY__'
$pluginStatusText = & $powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $pluginRuntimeEntry -ConfigPath $pluginRuntimeConfig -WaitReady
if ($LASTEXITCODE -ne 0) { throw 'ChatGPT plugin runtime failed to start.' }
$pluginStatus = $pluginStatusText | ConvertFrom-Json
if (-not $pluginStatus.tunnelReady) { Write-Warning ('ChatGPT plugin is reconnecting: ' + $pluginStatus.phase) }
'@
$hook = $hook.Replace('__RUNTIME_CONFIG__', $configPath.Replace("'", "''")).Replace('__RUNTIME_ENTRY__', (Join-Path $kit 'Ensure-ChatgptRuntime.ps1').Replace("'", "''"))
# The original launcher defines $powershell only in its cold-start branch.
$hook = '$powershell = Join-Path $env:SystemRoot ''System32\WindowsPowerShell\v1.0\powershell.exe''' + "`r`n" + $hook
$source = $source.Replace($anchor, $hook + "`r`n" + $anchor)
$source = $source.Replace("state='ready'; sourceSha=", "state=`$(if (`$pluginStatus.tunnelReady) {'ready'} else {'plugin-pending'}); pluginReady=`$pluginStatus.tunnelReady; pluginPhase=`$pluginStatus.phase; sourceSha=")
$temporary = $FormalLauncherPath + '.plugin-update.tmp'
try {
  [IO.File]::WriteAllText($temporary, $source, [Text.UTF8Encoding]::new($true))
  $parseErrors = $null; $parseTokens = $null
  [Management.Automation.Language.Parser]::ParseFile($temporary, [ref]$parseTokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count) { throw 'Patched launcher did not parse.' }
  Move-Item -LiteralPath $temporary -Destination $FormalLauncherPath -Force
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $kit 'Ensure-ChatgptRuntime.ps1') + '" -ConfigPath "' + $configPath + '"'
  $action = New-ScheduledTaskAction -Execute $previous.powershellPath -Argument $arguments -WorkingDirectory $previous.workRoot
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $task.Principal.UserId
  $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  Set-ScheduledTask -TaskName $task.TaskName -Action $action -Trigger @($logon, $repeat) | Out-Null
} catch {
  Copy-Item -LiteralPath (Join-Path $rollback 'Start-Formal4318.ps1') -Destination $FormalLauncherPath -Force
  Register-ScheduledTask -TaskName $task.TaskName -Xml ([IO.File]::ReadAllText((Join-Path $rollback 'autostart.xml'))) -Force | Out-Null
  throw
}
[pscustomobject]@{ Installed=$true; RuntimeConfig=$configPath; Rollback=$rollback; Task=$task.TaskName } | ConvertTo-Json
