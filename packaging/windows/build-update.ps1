param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$BasePayload,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference='Stop'
$sourcePath=[IO.Path]::GetFullPath($Source)
$basePath=[IO.Path]::GetFullPath($BasePayload)
$outPath=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outPath -Force | Out-Null
& node (Join-Path $PSScriptRoot 'stage-update.mjs') $sourcePath $basePath $outPath
if($LASTEXITCODE -ne 0){throw 'Update staging failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=Join-Path $outPath 'delta.zip'
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $outPath 'delta'),$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$info=Join-Path $outPath 'UpdateInfo.cs'
[IO.File]::WriteAllText($info,('internal static class UpdateInfo { public const string DeltaHash="'+$hash+'"; }'),[Text.UTF8Encoding]::new($false))
$exe=Join-Path $outPath 'zhixu-update-20261023.exe'
& C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /nologo /target:winexe /platform:x64 /optimize+ /utf8output "/win32icon:$PSScriptRoot/zhixu.ico" "/win32manifest:$PSScriptRoot/app.manifest" /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$exe" "/resource:$zip,delta.zip" "/resource:$outPath/update.json,update.json" "$PSScriptRoot/Updater.cs" $info
if($LASTEXITCODE -ne 0){throw 'Updater compilation failed'}
$exeHash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $outPath 'SHA256.txt'),($exeHash+'  zhixu-update-20261023.exe'+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
$catalog=[ordered]@{version='2026.10.23.1';url='/updates/zhixu-update-20261023.exe';sha256=$exeHash;bytes=(Get-Item -LiteralPath $exe).Length}
$catalog | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outPath 'latest.json') -Encoding utf8NoBOM
$catalog | ConvertTo-Json -Compress
