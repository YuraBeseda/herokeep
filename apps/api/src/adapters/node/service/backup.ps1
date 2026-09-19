<#
.SYNOPSIS
  Nightly backup of the herokeep Node adapter's data directory (ADR-014 Adapter B: "Task Scheduler
  runs a nightly script copying data\ ... to a second location"). Registered by Task Scheduler per
  docs/self-hosting-windows.md's "Backups" section; can also be run by hand.

.DESCRIPTION
  Why checkpoint-then-copy, not stop-service-then-copy: accounts.sqlite and streams.sqlite are
  opened in WAL mode (apps/api/src/adapters/node/db.sqlite.ts, store.sqlite-file.ts -- both call
  `PRAGMA journal_mode = WAL`). WAL is explicitly designed for concurrent, multi-PROCESS access: a
  second connection opened from a side process (this script, via node + the already-installed
  better-sqlite3 native module under the server's own node_modules) can safely run
  `PRAGMA wal_checkpoint(TRUNCATE)` against a live database file WHILE the herokeep-server service
  keeps it open and keeps serving requests -- SQLite's own file-locking protocol arbitrates this,
  the same way two ordinary SQLite readers/writers on the same WAL db coexist. A checkpoint folds
  the WAL file's pending pages back into the main .sqlite file and (TRUNCATE mode) shrinks the WAL
  back to empty, so the plain file copy that follows captures a self-consistent snapshot without
  ever stopping the service -- exactly ADR-014's "safe to copy after PRAGMA wal_checkpoint" claim
  (see store.sqlite-file.ts's openStreamsDb doc comment, which names this recipe by name).
  Stop-service-then-copy would ALSO be safe (and is a fine manual fallback if this script ever
  fails), but costs a service outage the checkpoint approach does not need to pay every night.

  This script does NOT invoke sqlite3.exe -- better-sqlite3 ships no CLI binary and this recipe
  does not require installing a separate sqlite3.exe; it reuses the native module the server
  already has installed (apps\api\node_modules\better-sqlite3) via a tiny inline Node script.

.PARAMETER DataDir
  The herokeep-server's HK_DATA_DIR (default matches install-service.ps1's own default).

.PARAMETER ApiDir
  The apps\api directory whose node_modules\better-sqlite3 this script borrows for the checkpoint
  step (must be the SAME install the running service uses, so the native module's ABI matches the
  Node version actually running).

.PARAMETER BackupRoot
  Where dated backup folders are written. Should be a second physical location (a different drive,
  a mapped network share, etc.) -- ADR-014's "to a second location".

.PARAMETER NodeExe
  Full path to node.exe. Default: resolved via `Get-Command node`.

.PARAMETER RetainDays
  Backups older than this many days under -BackupRoot are deleted after a successful new backup.
  0 disables pruning (default 30).

.EXAMPLE
  .\backup.ps1 -DataDir C:\ProgramData\Herokeep\data -ApiDir C:\Herokeep\herokeep-server\apps\api -BackupRoot D:\HerokeepBackups
#>
[CmdletBinding()]
param(
  [string]$DataDir = 'C:\ProgramData\Herokeep\data',
  [string]$ApiDir = 'C:\Herokeep\herokeep-server\apps\api',
  [Parameter(Mandatory = $true)]
  [string]$BackupRoot,
  [string]$NodeExe = '',
  [int]$RetainDays = 30
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeExe {
  param([string]$Explicit)
  if ($Explicit) { return $Explicit }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'node.exe not found on PATH. Pass -NodeExe <full path>.' }
  return $cmd.Source
}

$resolvedNode = Resolve-NodeExe -Explicit $NodeExe

$betterSqlite3Dir = Join-Path $ApiDir 'node_modules\better-sqlite3'
if (-not (Test-Path $betterSqlite3Dir)) {
  throw "better-sqlite3 not found under $betterSqlite3Dir -- is -ApiDir the same install the server runs from (after its 'pnpm install --prod' step)?"
}

$accountsDb = Join-Path $DataDir 'accounts.sqlite'
$streamsDb = Join-Path $DataDir 'streams.sqlite'
if (-not (Test-Path $accountsDb) -or -not (Test-Path $streamsDb)) {
  throw "accounts.sqlite / streams.sqlite not found under $DataDir -- has the server been started and seeded at least once?"
}

# Checkpoint step: a tiny inline CommonJS script (not this .ps1 file's own syntax) run via node,
# requiring better-sqlite3 from the SAME install the running service uses. Written to a temp file
# rather than `node -e` so the here-string's quoting stays simple and readable.
$checkpointScript = @'
const path = require("path");
const dbDir = process.argv[2];
const modulePath = process.argv[3];
const Database = require(modulePath);
for (const file of ["accounts.sqlite", "streams.sqlite"]) {
  const db = new Database(path.join(dbDir, file));
  const result = db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(file, JSON.stringify(result));
  db.close();
}
'@
$tempScript = Join-Path $env:TEMP "herokeep-backup-checkpoint-$([guid]::NewGuid()).cjs"
Set-Content -Path $tempScript -Value $checkpointScript -Encoding utf8
try {
  Write-Host "Checkpointing WAL files in $DataDir ..."
  & $resolvedNode $tempScript $DataDir $betterSqlite3Dir
  if ($LASTEXITCODE -ne 0) { throw "WAL checkpoint failed (node exit $LASTEXITCODE)." }
}
finally {
  Remove-Item -Force $tempScript -ErrorAction SilentlyContinue
}

# Copy step: the whole data dir (accounts.sqlite/streams.sqlite plus any residual -wal/-shm
# sidecar files -- TRUNCATE mode above should leave none, but copying them too is harmless and
# strictly safer than assuming they're gone) into a dated folder under -BackupRoot.
if (-not (Test-Path $BackupRoot)) {
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
}
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$destination = Join-Path $BackupRoot "herokeep-backup-$stamp"
Write-Host "Copying $DataDir -> $destination ..."
robocopy $DataDir $destination /E /R:2 /W:5 /NFL /NDL /NP | Out-Null
# robocopy's exit codes 0-7 are all "success" (bitmask of what it did, e.g. 1 = files copied);
# 8+ is a real failure. Reset $LASTEXITCODE to a plain 0/1 afterward so Task Scheduler's own
# history doesn't record a robocopy "1 = files copied" as a failed run.
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -ge 8) { throw "robocopy failed (exit $robocopyExitCode) copying $DataDir to $destination." }
$LASTEXITCODE = 0

Write-Host "Backup complete: $destination"

if ($RetainDays -gt 0) {
  $cutoff = (Get-Date).AddDays(-$RetainDays)
  Get-ChildItem -Path $BackupRoot -Directory -Filter 'herokeep-backup-*' |
    Where-Object { $_.CreationTime -lt $cutoff } |
    ForEach-Object {
      Write-Host "Pruning old backup: $($_.FullName)"
      Remove-Item -Recurse -Force $_.FullName
    }
}

exit 0
