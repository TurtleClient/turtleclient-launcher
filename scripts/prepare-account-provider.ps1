#requires -Version 7.0
param([string]$Archive, [string]$Extractor = (Join-Path $env:ProgramFiles '7-Zip/7z.exe'))
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskPin=Get-Content (Join-Path $taskRoot 'src-tauri/account-provider.json') -Raw | ConvertFrom-Json
$taskDestination=Join-Path $taskRoot 'src-tauri/account-provider/turtle-account-provider.exe'
if((Test-Path -LiteralPath $taskDestination) -and (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskPin.exe_sha256){return}
$taskScratch=Join-Path ([IO.Path]::GetTempPath()) ('turtle-account-package-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskScratch | Out-Null
if(!$Archive){
    $Archive=Join-Path $taskScratch 'provider.zip'
    try {
        Invoke-WebRequest -Uri $taskPin.url -OutFile $Archive -TimeoutSec 120
    } catch {
        Write-Warning 'Upstream account archive is unavailable. Using the pinned copy from the existing Turtle release.'
        $Archive=Join-Path $taskScratch 'turtle-release.exe'
        Invoke-WebRequest -Uri $taskPin.fallback.url -OutFile $Archive -TimeoutSec 120
    }
}
$taskArchiveHash=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskArchiveHash -eq $taskPin.fallback.sha256){
    if(!(Test-Path -LiteralPath $Extractor)){throw '7-Zip is required to extract the pinned account component.'}
    & $Extractor e $Archive $taskPin.fallback.entry "-o$taskScratch" -y *> (Join-Path $taskScratch 'extract.log')
    if($LASTEXITCODE -ne 0){throw 'Could not extract the pinned account component.'}
    $taskStaged=Join-Path $taskScratch 'turtle-account-provider.exe'
    if(!(Test-Path -LiteralPath $taskStaged) -or (Get-FileHash -LiteralPath $taskStaged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPin.exe_sha256){throw 'Account provider executable digest mismatch.'}
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskDestination) -Force | Out-Null
    Copy-Item -LiteralPath $taskStaged -Destination $taskDestination -Force
    Write-Output "Verified unchanged bundled account provider from Turtle release: $($taskPin.tag)"
    return
}
if($taskArchiveHash -ne $taskPin.sha256){throw 'Account provider archive digest mismatch.'}
$taskZip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
try{
    $taskEntry=$taskZip.GetEntry($taskPin.entry)
    if(!$taskEntry -or $taskEntry.Length -gt 128MB){throw 'Unexpected account provider archive.'}
    $taskInput=$taskEntry.Open()
    $taskStaged=Join-Path $taskScratch 'provider.exe'
    $taskOutput=[IO.File]::Create($taskStaged)
    try{$taskInput.CopyTo($taskOutput)}finally{$taskOutput.Dispose();$taskInput.Dispose()}
    if((Get-FileHash -LiteralPath $taskStaged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPin.exe_sha256){throw 'Account provider executable digest mismatch.'}
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskDestination) -Force | Out-Null
    Copy-Item -LiteralPath $taskStaged -Destination $taskDestination -Force
}finally{$taskZip.Dispose()}
Write-Output "Verified bundled account provider: $($taskPin.tag)"
