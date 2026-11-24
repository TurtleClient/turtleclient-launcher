#requires -Version 7.0
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskPin=Get-Content (Join-Path $taskRoot 'src-tauri/resources-preparer.json') -Raw | ConvertFrom-Json
$taskDestination=Join-Path $taskRoot 'src-tauri/resources-preparer.zip'
if((Test-Path -LiteralPath $taskDestination) -and (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskPin.sha256){return}
$taskClient=[Net.Http.HttpClient]::new()
try {
    $taskClient.Timeout=[TimeSpan]::FromSeconds(120)
    $taskBytes=$taskClient.GetByteArrayAsync($taskPin.url).GetAwaiter().GetResult()
    $taskHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskBytes)).ToLowerInvariant()
    if($taskHash -ne $taskPin.sha256){throw 'Resource preparer digest mismatch.'}
    [IO.File]::WriteAllBytes($taskDestination,$taskBytes)
} finally {
    $taskClient.Dispose()
}
Write-Output 'Verified Turtle Minecraft 26.3 resource preparer (no Minecraft files included).'
