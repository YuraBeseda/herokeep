<#
.SYNOPSIS
  Installs the herokeep Node adapter (src/adapters/node/server.ts) as a Windows service via NSSM
  (ADR-014 Adapter B deployment recipe; docs/self-hosting-windows.md is the full operator runbook
  this script is one step of -- read that doc first).

.DESCRIPTION
  NSSM (https://nssm.cc) is NOT installed by this script -- download it yourself (see the runbook)
  and either put nssm.exe on PATH or pass -NssmExe with a full path.

  This script only wires up the HEROKEEP SERVER service. Caddy (the TLS reverse proxy) is a
  separate NSSM service the runbook installs with its own two-line nssm invocation -- Caddy takes
  no app-specific environment/arguments beyond "run --config <path>", so it did not earn its own
  script.

  What this does, in order:
    1. Validates -InstallDir actually contains apps/api/src/adapters/node/server.ts (the zip/build
       layout docs/self-hosting-windows.md's "Getting the server" step produces).
    2. Validates apps/api/.env exists in -InstallDir (copied+edited from .env.example per the
       runbook's "Configure .env" step) -- refuses to install a service that would only crash-loop
       on assertConfigured's fail-fast check (apps/api/src/adapters/node/config.env.ts).
    3. Creates -DataDir if missing.
    4. `nssm install` with node.exe and the absolute path to server.ts as its argument (so the
       service's working directory never matters -- server.ts resolves every default from
       import.meta.url, not cwd, per that file's own NodeServerOptions doc comment).
    5. `nssm set` for AppDirectory, AppEnvironmentExtra (HK_HOST/HK_PORT/HK_DATA_DIR/
       HK_WEB_DIST_DIR -- server.ts's actual env vars), AppStdout/AppStderr log files under
       -DataDir\logs, AppExit Default Restart (crash-restart), and Start SERVICE_AUTO_START (survive
       reboot -- ADR-014's "run as Windows services ... so they survive reboots").

.PARAMETER ServiceName
  Windows service name. Default: HerokeepServer.

.PARAMETER InstallDir
  The extracted/updated herokeep-server bundle root -- the directory whose apps\api and apps\web
  subfolders were produced by the runbook's "Getting the server" step. Default:
  C:\Herokeep\herokeep-server.

.PARAMETER DataDir
  Directory accounts.sqlite/streams.sqlite live under (HK_DATA_DIR). Default:
  C:\ProgramData\Herokeep\data (ADR-014's %ProgramData%\Herokeep\data).

.PARAMETER HostAddress
  Bind host (HK_HOST). Default: 127.0.0.1 -- Caddy is the only thing that should ever be reachable
  from outside this machine; the Node server stays loopback-only behind it.

.PARAMETER Port
  Bind port (HK_PORT). Default: 8787 (server.ts's own DEFAULT_PORT).

.PARAMETER NodeExe
  Full path to node.exe. Default: resolved via `Get-Command node`.

.PARAMETER NssmExe
  Full path to nssm.exe, or a bare name resolvable on PATH. Default: nssm.

.EXAMPLE
  .\install-service.ps1 -InstallDir C:\Herokeep\herokeep-server

.EXAMPLE
  .\install-service.ps1 -ServiceName HerokeepServer -DataDir D:\HerokeepData -Port 8787
#>
[CmdletBinding()]
param(
  [string]$ServiceName = 'HerokeepServer',
  [string]$InstallDir = 'C:\Herokeep\herokeep-server',
  [string]$DataDir = 'C:\ProgramData\Herokeep\data',
  [string]$HostAddress = '127.0.0.1',
  [int]$Port = 8787,
  [string]$NodeExe = '',
  [string]$NssmExe = 'nssm'
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeExe {
  param([string]$Explicit)
  if ($Explicit) { return $Explicit }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw 'node.exe not found on PATH. Install Node 24 (see docs/self-hosting-windows.md) or pass -NodeExe <full path>.'
  }
  return $cmd.Source
}

$resolvedNode = Resolve-NodeExe -Explicit $NodeExe
$apiDir = Join-Path $InstallDir 'apps\api'
$serverScript = Join-Path $apiDir 'src\adapters\node\server.ts'
$webDistDir = Join-Path $InstallDir 'apps\web\dist'
$envFile = Join-Path $apiDir '.env'

if (-not (Test-Path $serverScript)) {
  throw "server.ts not found at $serverScript -- is -InstallDir ($InstallDir) a herokeep-server bundle? See docs/self-hosting-windows.md 'Getting the server'."
}
if (-not (Test-Path $envFile)) {
  throw ".env not found at $envFile -- copy apps\api\.env.example to apps\api\.env and fill in real secrets FIRST (docs/self-hosting-windows.md 'Configure .env'). Installing the service now would only crash-loop on boot (config.env.ts's assertConfigured fails fast on a missing secret)."
}

if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
}
$logDir = Join-Path $DataDir 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

Write-Host "Installing service '$ServiceName' -> $resolvedNode `"$serverScript`""
& $NssmExe install $ServiceName $resolvedNode $serverScript
if ($LASTEXITCODE -ne 0) { throw "nssm install failed (exit $LASTEXITCODE) -- is a service named '$ServiceName' already installed? 'nssm remove $ServiceName confirm' first." }

& $NssmExe set $ServiceName AppDirectory $apiDir
& $NssmExe set $ServiceName AppEnvironmentExtra "HK_HOST=$HostAddress" "HK_PORT=$Port" "HK_DATA_DIR=$DataDir" "HK_WEB_DIST_DIR=$webDistDir"
& $NssmExe set $ServiceName AppStdout (Join-Path $logDir 'server.out.log')
& $NssmExe set $ServiceName AppStderr (Join-Path $logDir 'server.err.log')
& $NssmExe set $ServiceName AppExit Default Restart
& $NssmExe set $ServiceName Start SERVICE_AUTO_START

Write-Host ''
Write-Host "Service '$ServiceName' installed. It is NOT started yet."
Write-Host "  Data dir : $DataDir"
Write-Host "  Web dist : $webDistDir"
Write-Host "  Logs     : $logDir"
Write-Host ''
Write-Host "Start it with:  nssm start $ServiceName"
Write-Host "Check status:   Get-Service $ServiceName"
Write-Host "Tail logs:      Get-Content `"$logDir\server.out.log`" -Wait"
