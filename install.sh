#!/bin/sh
# morgue installer — macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Clupai8o0/morgue/main/install.sh | sh
#
# Or, from a clone you already have:  sh install.sh
#
# This is the shell implementation of SETUP.md. If you change one, change both,
# and change install.ps1 too.
#
# ── Rules this script follows ──────────────────────────────────────────────
#
#   1. Say what it is about to do BEFORE doing it, with the disk cost, and exit
#      cleanly if the answer is no.
#   2. Never silently install a package manager the user did not ask for.
#      Homebrew is a 400MB decision, not an implementation detail.
#   3. Be idempotent. The first thing a stuck person does is run it again.
#   4. Fail with a sentence, not a stack trace.
#
# POSIX sh, deliberately: /bin/sh on macOS is bash 3.2 and on Debian is dash,
# and the intersection is small but completely adequate for eighty lines. A
# "universal" installer written in Node cannot run before Node exists, which is
# the entire problem this file solves.

set -eu

REPO_URL="${MORGUE_REPO:-https://github.com/Clupai8o0/morgue.git}"
DIR="${MORGUE_DIR:-$HOME/morgue}"
WANT_CAPTURE="${MORGUE_CAPTURE:-ask}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$(printf '\033[1m'); D=$(printf '\033[2m'); R=$(printf '\033[31m')
  G=$(printf '\033[32m'); Y=$(printf '\033[33m'); X=$(printf '\033[0m')
else
  B=''; D=''; R=''; G=''; Y=''; X=''
fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s\n' "$B" "$X" "$*"; }
warn() { printf '%s !%s %s\n' "$Y" "$X" "$*"; }
die()  { printf '\n%s%s%s\n\n' "$R" "$*" "$X" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Prompts default to NO on anything that installs software, and default to yes
# only where the alternative is doing nothing.
#
# When stdin is not a terminal — which is the `curl … | sh` case, i.e. the one
# on the label — there is nobody to ask. Read from /dev/tty if we can; if not,
# take the default and say so, rather than blocking forever on a read that will
# never return.
ask() {
  _q="$1"; _default="${2:-n}"
  if [ "$_default" = "y" ]; then _hint="[Y/n]"; else _hint="[y/N]"; fi
  if [ -r /dev/tty ]; then
    printf '%s %s ' "$_q" "$_hint" > /dev/tty
    read -r _a < /dev/tty || _a=''
  else
    printf '%s %s %s(no terminal — assuming %s)%s\n' "$_q" "$_hint" "$D" "$_default" "$X"
    _a=''
  fi
  [ -z "$_a" ] && _a="$_default"
  case "$_a" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# ── platform ────────────────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  *) die "morgue's installer supports macOS and Linux. On Windows use install.ps1.
On $OS, follow SETUP.md by hand — every step is a single command." ;;
esac

PM=none
if [ "$PLATFORM" = macos ]; then
  have brew && PM=brew
else
  for m in dnf apt-get pacman zypper apk; do have "$m" && { PM="$m"; break; }; done
fi

# One place that knows how to install a thing, so a fix printed in a message and
# a fix run by the script cannot disagree.
pkg_cmd() {
  case "$PM:$1" in
    brew:node)        echo "brew install node" ;;
    brew:ffmpeg)      echo "brew install ffmpeg" ;;
    brew:git)         echo "brew install git" ;;
    dnf:node)         echo "sudo dnf install -y nodejs" ;;
    dnf:ffmpeg)       echo "sudo dnf install -y ffmpeg --allowerasing" ;;
    dnf:git)          echo "sudo dnf install -y git" ;;
    apt-get:node)     echo "sudo apt-get install -y nodejs" ;;
    apt-get:ffmpeg)   echo "sudo apt-get install -y ffmpeg" ;;
    apt-get:git)      echo "sudo apt-get install -y git" ;;
    pacman:node)      echo "sudo pacman -S --noconfirm nodejs" ;;
    pacman:ffmpeg)    echo "sudo pacman -S --noconfirm ffmpeg" ;;
    pacman:git)       echo "sudo pacman -S --noconfirm git" ;;
    zypper:node)      echo "sudo zypper install -y nodejs" ;;
    zypper:ffmpeg)    echo "sudo zypper install -y ffmpeg" ;;
    zypper:git)       echo "sudo zypper install -y git" ;;
    apk:node)         echo "sudo apk add nodejs" ;;
    apk:ffmpeg)       echo "sudo apk add ffmpeg" ;;
    apk:git)          echo "sudo apk add git" ;;
    *) echo "" ;;
  esac
}

# Runs a package-manager command, having shown it first. Refusal is not an
# error: the person may prefer to install it their own way, and the checks
# afterwards will tell them if they did not.
install_pkg() {
  _what="$1"; _cmd="$(pkg_cmd "$_what")"
  if [ -z "$_cmd" ]; then
    if [ "$PLATFORM" = macos ] && [ "$PM" = none ]; then
      warn "Homebrew is not installed, so I cannot install $_what for you."
      say  "  Install it from https://brew.sh — then re-run this script."
    else
      warn "I do not know how to install $_what with your package manager."
      say  "  Install $_what, then re-run this script."
    fi
    return 1
  fi
  say "  I will run: ${B}$_cmd${X}"
  ask "  Go ahead?" y || { warn "skipped — install $_what yourself, then re-run"; return 1; }
  sh -c "$_cmd" || { warn "that command failed"; return 1; }
  return 0
}

# ── banner ──────────────────────────────────────────────────────────────────

cat <<BANNER

${B}morgue${X} ${D}— a drawer of clippings for motion on the web${X}

This will set up a ${B}local${X} morgue: one machine, no accounts, no cloud
services, nothing leaving this computer.

  ${D}where${X}      $DIR
  ${D}platform${X}   $PLATFORM${D}, package manager: ${X}$PM

It needs, and will check for:
  ${D}·${X} Node 22+ and pnpm            ${D}(~600MB of dependencies)${X}
  ${D}·${X} ffmpeg + Chrome              ${D}(~400MB — only to RECORD previews;${X}
                                 ${D} browsing works without them)${X}

Nothing is installed without asking first.
BANNER

ask "Continue?" y || { say "nothing done."; exit 0; }

# ── 1. git (only if we have to clone) ───────────────────────────────────────

if [ -f "./package.json" ] && grep -q '"name": "morgue"' ./package.json 2>/dev/null; then
  DIR="$(pwd)"
  step "using the morgue already in $DIR"
else
  step "getting morgue"
  if ! have git; then
    say "  git is missing."
    install_pkg git || die "git is required to download morgue. Install it and re-run."
  fi
  if [ -d "$DIR/.git" ]; then
    say "  ${G}already there${X} — $DIR ${D}(leaving it alone; \`git pull\` to update)${X}"
  else
    say "  cloning into $DIR"
    git clone --depth 1 "$REPO_URL" "$DIR" || die "could not clone $REPO_URL"
  fi
fi

cd "$DIR" || die "could not enter $DIR"

# ── 2. Node ─────────────────────────────────────────────────────────────────

step "Node"
NODE_OK=no
if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    say "  ${G}ok${X} $(node --version)"
    NODE_OK=yes
  else
    warn "$(node --version) is too old — morgue needs 22 or newer"
  fi
else
  say "  not installed."
fi

if [ "$NODE_OK" = no ]; then
  install_pkg node || true
  have node || die "Node is still missing. Install Node 22+ from https://nodejs.org and re-run."
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || die "Node $(node --version) is too old.
Your package manager has an old build. Install 22+ from https://nodejs.org
(macOS: brew install node) and re-run this script."
  say "  ${G}ok${X} $(node --version)"
fi

# ── 3. pnpm ─────────────────────────────────────────────────────────────────

step "pnpm"
if have pnpm; then
  say "  ${G}ok${X} v$(pnpm --version)"
else
  # corepack ships with Node, so this downloads nothing new and behaves the
  # same on all three platforms. That is why it is not in the pkg_cmd table.
  say "  enabling it through corepack (ships with Node — no download)"
  corepack enable pnpm 2>/dev/null || warn "corepack could not enable pnpm"
  have pnpm || die "pnpm is still missing. Try:  corepack enable pnpm
If corepack is unavailable:  npm install -g pnpm"
  say "  ${G}ok${X} v$(pnpm --version)"
fi

# ── 4. dependencies ─────────────────────────────────────────────────────────

step "dependencies ${D}(~600MB, a few minutes the first time)${X}"
pnpm install || die "pnpm install failed. The output above says why; it is usually
a network problem or a permissions problem in ~/.pnpm-store."
say "  ${G}ok${X} installed"

# ── 5. capture tier — optional, and the expensive half ──────────────────────

step "recording previews ${D}(optional)${X}"
cat <<EOF
  Browsing, searching, notes and export all work without this.
  Recording new previews needs ffmpeg and Playwright's own Chrome — about 400MB.
EOF

DO_CAPTURE=no
case "$WANT_CAPTURE" in
  yes|1) DO_CAPTURE=yes ;;
  no|0)  DO_CAPTURE=no ;;
  *)     ask "  Install the recording tools too?" y && DO_CAPTURE=yes ;;
esac

if [ "$DO_CAPTURE" = yes ]; then
  # Capability, not presence. Fedora's ffmpeg-free is a real ffmpeg with no
  # libx264 — it passes `command -v` and then fails at the encode.
  if have ffmpeg && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q ' libx264 '; then
    say "  ${G}ok${X} ffmpeg can encode h.264"
  else
    if have ffmpeg; then
      warn "this ffmpeg has no libx264 encoder (Fedora's ffmpeg-free is the usual cause)"
    else
      say "  ffmpeg is not installed."
    fi
    install_pkg ffmpeg || true
  fi

  say "  downloading Chrome for Playwright …"
  pnpm exec playwright install chromium || warn "Chrome did not download — run \`pnpm exec playwright install chromium\` later"
fi

# ── 6. hand over to the real checker ────────────────────────────────────────

step "checking"
# Deliberately not re-implemented here. bin/doctor.mjs is the one place that
# knows what morgue needs, and a shell script with its own opinion would drift
# from it within a month. It also prints the per-platform fix for anything
# still missing, which is the whole value.
if pnpm doctor; then
  cat <<DONE

${G}${B}Done.${X}

  cd $DIR
  pnpm morgue

That builds what needs building, starts a server and opens your browser.
The first run takes a couple of minutes; after that it is seconds.

${D}items/ is empty in a fresh clone — the collection is not distributable, so
you will see the 11 examples that ship with morgue until you add your own.
CLAUDE.md is the folder contract; SETUP.md has the details.${X}

DONE
else
  cat <<PARTIAL

${Y}Set up, but something is missing.${X} The list above says what and how to fix it.
You can still run it:

  cd $DIR
  pnpm morgue

PARTIAL
fi
