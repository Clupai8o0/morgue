# morgue installer — Windows.
#
#   irm https://raw.githubusercontent.com/Clupai8o0/morgue/main/install.ps1 | iex
#
# Or, from a clone you already have:  powershell -ExecutionPolicy Bypass -File install.ps1
#
# This is the PowerShell implementation of SETUP.md, and the sibling of
# install.sh. If you change one, change all three.
#
# ── Rules this script follows ──────────────────────────────────────────────
#
#   1. Say what it is about to do BEFORE doing it, with the disk cost, and exit
#      cleanly if the answer is no.
#   2. Never silently install a package manager the user did not ask for.
#   3. Be idempotent. The first thing a stuck person does is run it again.
#   4. Fail with a sentence, not a stack trace.
#
# Two scripts rather than one clever cross-platform one, because a "universal"
# installer written in Node cannot run before Node exists — which is the entire
# problem this file solves.

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:MORGUE_REPO) { $env:MORGUE_REPO } else { 'https://github.com/Clupai8o0/morgue.git' }
$Dir     = if ($env:MORGUE_DIR)  { $env:MORGUE_DIR }  else { Join-Path $HOME 'morgue' }
$Capture = if ($env:MORGUE_CAPTURE) { $env:MORGUE_CAPTURE } else { 'ask' }

function Say  { param($m) Write-Host $m }
function Step { param($m) Write-Host ''; Write-Host "==> $m" -ForegroundColor White }
function Warn { param($m) Write-Host " ! $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host ''; Write-Host $m -ForegroundColor Red; Write-Host ''; exit 1 }
function Have { param($c) [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# Defaults to NO on anything that installs software. When there is no console
# to read from — the `irm | iex` case, i.e. the one on the label — take the
# default and say so rather than blocking on a read that never returns.
function Ask {
  param($Question, $Default = 'n')
  $hint = if ($Default -eq 'y') { '[Y/n]' } else { '[y/N]' }
  $answer = ''
  try {
    if (-not [Console]::IsInputRedirected) {
      $answer = Read-Host "$Question $hint"
    } else {
      Say "$Question $hint (no console — assuming $Default)"
    }
  } catch {
    Say "$Question $hint (no console — assuming $Default)"
  }
  if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $Default }
  return $answer -match '^[Yy]'
}

# winget is present on Windows 11 and on updated Windows 10. If it is not,
# every install below becomes a link rather than a command — deliberately: a
# script that bootstraps a package manager unasked is doing something the
# person did not agree to.
$HasWinget = Have 'winget'

function Install-Pkg {
  param($Name, $Id, $Url)
  if (-not $HasWinget) {
    Warn "winget is not available, so I cannot install $Name for you."
    Say  "  Download it from $Url — then re-run this script."
    return $false
  }
  Say "  I will run: winget install $Id"
  if (-not (Ask '  Go ahead?' 'y')) { Warn "skipped — install $Name yourself, then re-run"; return $false }
  winget install --id $Id --accept-source-agreements --accept-package-agreements -e
  if ($LASTEXITCODE -ne 0) { Warn 'that command failed'; return $false }
  # winget updates the machine PATH, but not this process's copy of it, so a
  # freshly installed binary is invisible until the shell is restarted. Re-read
  # it here or the check immediately below reports the thing we just installed
  # as missing.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
  return $true
}

# ── banner ──────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host 'morgue' -ForegroundColor White -NoNewline
Write-Host ' - a drawer of clippings for motion on the web'
Write-Host ''
Say 'This will set up a LOCAL morgue: one machine, no accounts, no cloud'
Say 'services, nothing leaving this computer.'
Write-Host ''
Say "  where      $Dir"
Say "  winget     $(if ($HasWinget) { 'available' } else { 'NOT available - installs become links' })"
Write-Host ''
Say 'It needs, and will check for:'
Say '  - Node 22+ and pnpm            (~600MB of dependencies)'
Say '  - ffmpeg + Chrome              (~400MB - only to RECORD previews;'
Say '                                  browsing works without them)'
Write-Host ''
Say 'Nothing is installed without asking first.'
Write-Host ''

if (-not (Ask 'Continue?' 'y')) { Say 'nothing done.'; exit 0 }

# ── 1. git (only if we have to clone) ───────────────────────────────────────

$pkgJson = Join-Path (Get-Location) 'package.json'
if ((Test-Path $pkgJson) -and ((Get-Content $pkgJson -Raw) -match '"name":\s*"morgue"')) {
  $Dir = (Get-Location).Path
  Step "using the morgue already in $Dir"
} else {
  Step 'getting morgue'
  if (-not (Have 'git')) {
    Say '  git is missing.'
    if (-not (Install-Pkg 'git' 'Git.Git' 'https://git-scm.com/download/win')) {
      Die 'git is required to download morgue. Install it and re-run.'
    }
  }
  if (Test-Path (Join-Path $Dir '.git')) {
    Say "  already there - $Dir (leaving it alone; ``git pull`` to update)"
  } else {
    Say "  cloning into $Dir"
    git clone --depth 1 $RepoUrl $Dir
    if ($LASTEXITCODE -ne 0) { Die "could not clone $RepoUrl" }
  }
}

Set-Location $Dir

# ── 2. Node ─────────────────────────────────────────────────────────────────

Step 'Node'
$nodeOk = $false
if (Have 'node') {
  $major = [int](node -p 'process.versions.node.split(".")[0]')
  if ($major -ge 22) { Say "  ok $(node --version)"; $nodeOk = $true }
  else { Warn "$(node --version) is too old - morgue needs 22 or newer" }
} else {
  Say '  not installed.'
}

if (-not $nodeOk) {
  Install-Pkg 'Node' 'OpenJS.NodeJS.LTS' 'https://nodejs.org' | Out-Null
  if (-not (Have 'node')) {
    Die @'
Node is still missing. Install Node 22+ from https://nodejs.org and re-run.

If you just installed it, close this window and open a NEW terminal first -
Windows only gives a new PATH to newly started shells.
'@
  }
  $major = [int](node -p 'process.versions.node.split(".")[0]')
  if ($major -lt 22) { Die "Node $(node --version) is too old. Install 22+ from https://nodejs.org and re-run." }
  Say "  ok $(node --version)"
}

# ── 3. pnpm ─────────────────────────────────────────────────────────────────

Step 'pnpm'
if (Have 'pnpm') {
  Say "  ok v$(pnpm --version)"
} else {
  # corepack ships with Node, so this downloads nothing new.
  Say '  enabling it through corepack (ships with Node - no download)'
  corepack enable pnpm 2>$null
  if (-not (Have 'pnpm')) {
    Die @'
pnpm is still missing. Try:  corepack enable pnpm
If corepack is unavailable:  npm install -g pnpm
'@
  }
  Say "  ok v$(pnpm --version)"
}

# ── 4. dependencies ─────────────────────────────────────────────────────────

Step 'dependencies (~600MB, a few minutes the first time)'
pnpm install
if ($LASTEXITCODE -ne 0) {
  Die 'pnpm install failed. The output above says why; it is usually a network problem.'
}
Say '  ok installed'

# ── 5. capture tier — optional, and the expensive half ──────────────────────

Step 'recording previews (optional)'
Say '  Browsing, searching, notes and export all work without this.'
Say "  Recording new previews needs ffmpeg and Playwright's own Chrome - about 400MB."

$doCapture = switch ($Capture) {
  { $_ -in 'yes', '1' } { $true }
  { $_ -in 'no', '0' }  { $false }
  default { Ask '  Install the recording tools too?' 'y' }
}

if ($doCapture) {
  # Capability, not presence: an ffmpeg build without libx264 passes every
  # presence check and then fails at the encode.
  $ffmpegOk = $false
  if (Have 'ffmpeg') {
    $encoders = (ffmpeg -hide_banner -encoders 2>$null | Out-String)
    if ($encoders -match '\slibx264\s') { $ffmpegOk = $true }
    else { Warn 'this ffmpeg has no libx264 encoder' }
  } else {
    Say '  ffmpeg is not installed.'
  }
  if ($ffmpegOk) { Say '  ok ffmpeg can encode h.264' }
  else { Install-Pkg 'ffmpeg' 'Gyan.FFmpeg' 'https://ffmpeg.org/download.html' | Out-Null }

  Say '  downloading Chrome for Playwright ...'
  pnpm exec playwright install chromium
  if ($LASTEXITCODE -ne 0) { Warn 'Chrome did not download - run `pnpm exec playwright install chromium` later' }
}

# ── 6. hand over to the real checker ────────────────────────────────────────

Step 'checking'
# Deliberately not re-implemented here. bin/doctor.mjs is the one place that
# knows what morgue needs; a PowerShell script with its own opinion would drift
# from it within a month.
pnpm doctor
$doctorOk = ($LASTEXITCODE -eq 0)

Write-Host ''
if ($doctorOk) {
  Write-Host 'Done.' -ForegroundColor Green
  Write-Host ''
  Say "  cd $Dir"
  Say '  pnpm morgue'
  Write-Host ''
  Say 'That builds what needs building, starts a server and opens your browser.'
  Say 'The first run takes a couple of minutes; after that it is seconds.'
  Write-Host ''
  Say 'items/ is empty in a fresh clone - the collection is not distributable, so'
  Say 'you will see the 11 examples that ship with morgue until you add your own.'
  Say 'CLAUDE.md is the folder contract; SETUP.md has the details.'
} else {
  Write-Host 'Set up, but something is missing.' -ForegroundColor Yellow
  Say 'The list above says what and how to fix it. You can still run it:'
  Write-Host ''
  Say "  cd $Dir"
  Say '  pnpm morgue'
}
Write-Host ''
