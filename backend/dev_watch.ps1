$ErrorActionPreference = "Stop"

$PY = "C:\Users\dfern\AppData\Local\Programs\Python\Python312\python.exe"
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8001
$stdoutPath = Join-Path $backendDir ".dev_watch.stdout.log"
$stderrPath = Join-Path $backendDir ".dev_watch.stderr.log"

function Get-LastWriteUtc([string] $path) {
  $latest = Get-ChildItem -Path $path -Recurse -File -Filter "*.py" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) { return [DateTime]::MinValue }
  return $latest.LastWriteTimeUtc
}

function Kill-Port([int] $p) {
  $lines = netstat -ano | findstr ":$p" | Select-String "LISTENING" -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    $parts = ($line.Line -split "\s+")
    $owningPid = $parts[-1]
    if ($owningPid -match "^\d+$" -and $owningPid -ne "0") {
      taskkill /F /PID $owningPid /T 2>$null | Out-Null
    }
  }
}

function Start-Backend() {
  if (Test-Path $stdoutPath) { Remove-Item -Force $stdoutPath -ErrorAction SilentlyContinue }
  if (Test-Path $stderrPath) { Remove-Item -Force $stderrPath -ErrorAction SilentlyContinue }

  Start-Process -FilePath $PY -WorkingDirectory $backendDir -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -ArgumentList @(
    "-B", "-m", "flask", "--app", "app.main:app", "run", "--host", "127.0.0.1", "--port", "$port", "--no-reload"
  )
}

$env:PYTHONDONTWRITEBYTECODE = "1"
$env:FLASK_DEBUG = "1"
$env:PYTHONPATH = "$backendDir\_deps;$backendDir"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

$last = Get-LastWriteUtc "$backendDir\app"

try {
  while ($true) {
    Kill-Port $port

    $proc = Start-Backend
    Start-Sleep -Seconds 1

    while (-not $proc.HasExited) {
      Start-Sleep -Seconds 1
      $next = Get-LastWriteUtc "$backendDir\app"
      if ($next -gt $last) {
        $last = $next
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
        break
      }
    }

    if ($proc.HasExited) {
      $exitCode = $proc.ExitCode
      if ($exitCode -ne 0) {
        "Backend terminó con exit code $exitCode"
        if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Tail 40 }
      }
      Start-Sleep -Seconds 1
    }
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
