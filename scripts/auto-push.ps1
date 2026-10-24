$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logPath = Join-Path $projectRoot '.git/auto-push.log'
$lockPath = Join-Path $projectRoot '.git/auto-push.lock'
$lock = $null

function Invoke-Git {
    param([string[]]$GitArgs)
    $ErrorActionPreference = 'Continue'
    $output = & git @GitArgs 2>&1
    $code = $LASTEXITCODE
    if ($output) { $output | Out-File -LiteralPath $logPath -Append -Encoding utf8 }
    if ($code -ne 0) { throw "git $($GitArgs -join ' ') failed (exit $code). See $logPath" }
}

try {
    try {
        $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [System.IO.IOException] { exit 0 }
    "[$(Get-Date -Format o)] Sync started" | Out-File -LiteralPath $logPath -Append -Encoding utf8
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Auto push requires the main branch.' }
    Invoke-Git -GitArgs @('fetch', 'origin', 'main')
    & git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Remote main has new commits. Integrate them manually before syncing.' }
    Invoke-Git -GitArgs @('add', '--all')
    & git diff --cached --quiet
    $diffCode = $LASTEXITCODE
    if ($diffCode -eq 1) {
        Invoke-Git -GitArgs @('commit', '-m', "Auto sync $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    } elseif ($diffCode -ne 0) { throw 'Unable to inspect staged changes.' }
    Invoke-Git -GitArgs @('push', 'origin', 'main')
} catch {
    "[$(Get-Date -Format o)] ERROR: $_" | Out-File -LiteralPath $logPath -Append -Encoding utf8
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
