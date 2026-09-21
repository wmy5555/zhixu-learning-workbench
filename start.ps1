param(
  [switch]$NoBrowser,
  [switch]$Timing,
  [ValidateRange(1, 65535)][int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 4318 })
)
$ErrorActionPreference = 'Stop'
$watch = [Diagnostics.Stopwatch]::StartNew()
Set-Location -LiteralPath $PSScriptRoot
$url = "http://127.0.0.1:$Port"

function Test-WorkbenchReady {
  $socket = [Net.Sockets.TcpClient]::new()
  $response = $null
  $reader = $null
  try {
    # .NET Framework can retry a refused HTTP connection for seconds on Windows.
    # Bound the closed-port case before making the identifying HTTP request.
    $connection = $socket.ConnectAsync('127.0.0.1', $Port)
    if (-not $connection.Wait(50) -or -not $socket.Connected) { return $false }
    $socket.Dispose()
    # Probe inside this process: no Node startup, proxy discovery or redirects.
    $request = [Net.HttpWebRequest]::Create("$url/")
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 1500
    $request.ReadWriteTimeout = 1500
    $response = $request.GetResponse()
    $reader = [IO.StreamReader]::new($response.GetResponseStream())
    return [int]$response.StatusCode -eq 200 -and $reader.ReadToEnd().Contains('app.mjs')
  } catch { return $false }
  finally {
    $socket.Dispose()
    if ($reader) { $reader.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

function Open-Workbench {
  $readyMs = $watch.ElapsedMilliseconds
  if (-not $NoBrowser) { Start-Process $url }
  if ($Timing) {
    # Dispatch is not the time when the browser finishes rendering the page.
    Write-Output ("ReadyMs={0}; BrowserDispatchMs={1}; TotalMs={2}" -f $readyMs, ($watch.ElapsedMilliseconds - $readyMs), $watch.ElapsedMilliseconds)
  }
}

# An already running service needs neither runtime discovery nor filesystem writes.
if (Test-WorkbenchReady) { Open-Workbench; exit 0 }

$dataPath = Join-Path $PSScriptRoot '.data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
# Get-Command can search modules even for a missing executable. Inspect PATH directly.
$nodePath = $null
foreach ($entry in ($env:PATH -split ';')) {
  if ([string]::IsNullOrWhiteSpace($entry)) { continue }
  $candidate = [IO.Path]::Combine([Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"')), 'node.exe')
  if ([IO.File]::Exists($candidate)) { $nodePath = $candidate; break }
}
if (-not $nodePath) { $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ and try again.' }
$nodeMajor = ((& $nodePath --version).TrimStart('v').Split('.')[0])
if ([int]$nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\yaml'))) { throw 'Dependencies are missing. Run install.cmd first.' }
$serverPath = Join-Path $PSScriptRoot 'src\server.mjs'
$env:PORT = [string]$Port
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log')
[IO.File]::WriteAllText((Join-Path $dataPath 'web.pid'), [string]$process.Id)
$deadline = $watch.ElapsedMilliseconds + 15000
while ($watch.ElapsedMilliseconds -lt $deadline) {
  if ($process.HasExited) { throw 'The server stopped. See .data/server-error.log.' }
  if (Test-WorkbenchReady) { Open-Workbench; exit 0 }
  Start-Sleep -Milliseconds 50
}
throw 'Startup timed out. See .data/server-error.log.'
