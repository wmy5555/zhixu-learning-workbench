param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$BasePayload,
  [Parameter(Mandatory=$true)][string]$Output,
  [switch]$CompileOnly,
  [string]$ExeName='zhixu-update-20261023-r2.exe'
)
$ErrorActionPreference='Stop'
$sourcePath=[IO.Path]::GetFullPath($Source)
$basePath=[IO.Path]::GetFullPath($BasePayload)
$outPath=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outPath -Force | Out-Null
if(-not $CompileOnly){
  & node (Join-Path $PSScriptRoot 'stage-update.mjs') $sourcePath $basePath $outPath
  if($LASTEXITCODE -ne 0){throw 'Update staging failed'}
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=Join-Path $outPath 'delta.zip'
if(-not $CompileOnly){[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $outPath 'delta'),$zip,[IO.Compression.CompressionLevel]::Optimal,$false)}
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$info=Join-Path $outPath 'UpdateInfo.cs'
[IO.File]::WriteAllText($info,('internal static class UpdateInfo { public const string DeltaHash="'+$hash+'"; }'),[Text.UTF8Encoding]::new($false))
$exe=Join-Path $outPath $ExeName
$iconPath=Join-Path $PSScriptRoot 'zhixu.ico'
$manifestPath=Join-Path $PSScriptRoot 'app.manifest'
$sourceFile=Join-Path $PSScriptRoot 'Updater.cs'
$windowFile=Join-Path $PSScriptRoot 'UpdateWindow.cs'
$updateManifest=Join-Path $outPath 'update.json'
& C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /nologo /target:winexe /platform:x64 /optimize+ /utf8output "/win32icon:$iconPath" "/win32manifest:$manifestPath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$exe" "/resource:$zip,delta.zip" "/resource:$updateManifest,update.json" $sourceFile $windowFile $info
if($LASTEXITCODE -ne 0){throw 'Updater compilation failed'}
$exeHash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $outPath 'SHA256.txt'),($exeHash+'  '+$ExeName+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
$catalog=[ordered]@{version='2026.10.23.1';url=('/updates/'+$ExeName);sha256=$exeHash;bytes=(Get-Item -LiteralPath $exe).Length}
$catalog | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outPath 'latest.json') -Encoding utf8NoBOM
$catalog | ConvertTo-Json -Compress
