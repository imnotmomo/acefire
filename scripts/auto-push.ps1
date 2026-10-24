$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logPath = Join-Path $projectRoot '.git/auto-push.log'
$lockPath = Join-Path $projectRoot '.git/auto-push.lock'
$lock = $null

function Invoke-Git {
    param([string[]]$GitArgs, [int[]]$AllowedExitCodes = @(0))
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command git -CommandType Application | Select-Object -First 1).Source
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Arguments = ($GitArgs | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(120000)) {
            $process.Kill()
            throw 'Git operation timed out.'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        if ($errors) { $errors | Out-File -LiteralPath $logPath -Append -Encoding utf8 }
        if ($AllowedExitCodes -notcontains $process.ExitCode) {
            throw "git $($GitArgs -join ' ') failed (exit $($process.ExitCode)). See $logPath"
        }
        return [pscustomobject]@{ Output = $output; ExitCode = $process.ExitCode }
    } finally { $process.Dispose() }
}

try {
    try {
        $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [System.IO.IOException] { exit 0 }
    "[$(Get-Date -Format o)] Sync started" | Out-File -LiteralPath $logPath -Append -Encoding utf8
    $branch = (Invoke-Git -GitArgs @('branch', '--show-current')).Output.Trim()
    if ($branch -ne 'main') { throw 'Auto push requires the main branch.' }
    $null = Invoke-Git -GitArgs @('fetch', 'origin', 'main')
    $ancestor = Invoke-Git -GitArgs @('merge-base', '--is-ancestor', 'origin/main', 'HEAD') -AllowedExitCodes @(0, 1)
    if ($ancestor.ExitCode -ne 0) { throw 'Remote main has new commits. Integrate them manually before syncing.' }
    $staged = (Invoke-Git -GitArgs @('diff', '--cached', '--name-only', '-z')).Output
    foreach ($path in $staged.Split([char]0)) {
        if ($path -and -not $path.StartsWith('frontend/')) { throw 'Other directories have staged changes. Commit or unstage them manually.' }
    }
    $null = Invoke-Git -GitArgs @('add', '--all', '--', 'frontend')
    $diffCode = (Invoke-Git -GitArgs @('diff', '--cached', '--quiet') -AllowedExitCodes @(0, 1)).ExitCode
    if ($diffCode -eq 1) {
        $null = Invoke-Git -GitArgs @('commit', '-m', "Auto sync frontend $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    } elseif ($diffCode -ne 0) { throw 'Unable to inspect staged changes.' }
    $null = Invoke-Git -GitArgs @('push', 'origin', 'main')
    "[$(Get-Date -Format o)] Sync completed" | Out-File -LiteralPath $logPath -Append -Encoding utf8
} catch {
    "[$(Get-Date -Format o)] ERROR: $_" | Out-File -LiteralPath $logPath -Append -Encoding utf8
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
