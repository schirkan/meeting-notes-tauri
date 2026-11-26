# Creates an unsigned, separate x64 lab MSIX. Never registers the package or installs a model.
param([string]$MakeAppxPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'src-tauri\target'
$hostExe = Join-Path $target 'release\MeetingNotes.exe'
if (!(Test-Path -LiteralPath $hostExe -PathType Leaf)) {
    throw 'Build the release host first: npm run tauri -- build --no-bundle'
}
if (!$MakeAppxPath) {
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $MakeAppxPath = Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^10\.\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\makeappx.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (!$MakeAppxPath) { throw 'Install a recent Windows SDK with MakeAppx, or pass -MakeAppxPath.' }

$output = Join-Path $target 'windows-ai-speech-lab'
$stage = Join-Path $output ([guid]::NewGuid().ToString('N'))
$assets = Join-Path $stage 'Assets'
$project = Join-Path $root 'sidecar\MeetingNotes.Sidecar.csproj'
$template = Join-Path $root 'packaging\windows-ai-speech\AppxManifest.xml'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric three-part app version.' }
$package = Join-Path $output "MeetingNotes.WindowsAiSpeechLab-$version-x64.unsigned.msix"

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    dotnet publish $project -c Release -r win-x64 '-p:EnableWindowsAiSpeech=true' --artifacts-path (Join-Path $output 'sidecar-artifacts') -o $stage
    if ($LASTEXITCODE -ne 0) { throw "Windows AI Speech sidecar publish failed ($LASTEXITCODE)." }
    foreach ($file in 'MeetingNotes.Sidecar.exe', 'Microsoft.Windows.AI.Speech.dll') {
        if (!(Test-Path -LiteralPath (Join-Path $stage $file) -PathType Leaf)) { throw "Experimental sidecar output is missing $file." }
    }
    Copy-Item -LiteralPath $hostExe -Destination $stage
    $xml = (Get-Content -LiteralPath $template -Raw).Replace('@VERSION@', "$version.0")
    [IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $xml)

    New-Item -ItemType Directory -Path $assets | Out-Null
    Add-Type -AssemblyName System.Drawing
    $icon = [Drawing.Image]::FromFile((Join-Path $root 'src-tauri\icons\128x128.png'))
    try {
        foreach ($logo in @(@{ Name = 'Logo.png'; Size = 50 }, @{ Name = 'Square150x150Logo.png'; Size = 150 }, @{ Name = 'Square44x44Logo.png'; Size = 44 })) {
            $bitmap = [Drawing.Bitmap]::new($icon, $logo.Size, $logo.Size)
            try { $bitmap.Save((Join-Path $assets $logo.Name), [Drawing.Imaging.ImageFormat]::Png) }
            finally { $bitmap.Dispose() }
        }
    } finally { $icon.Dispose() }

    & $MakeAppxPath pack /d $stage /p $package /o
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed ($LASTEXITCODE)." }
    Write-Output $package
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
