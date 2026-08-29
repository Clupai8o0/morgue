#!/bin/bash
# fetch-attachments.sh <urls.tsv> <dest-dir> [parallel]
#
# Downloads every `name<TAB>url` row of urls.tsv into dest-dir.
# Resumable: a file already on disk that passes `unzip -t` is skipped, so
# re-running after a partial or failed run costs nothing.
#
# An archive is only promoted from `.part` to its real name once it has passed
# an integrity check, so an interrupted run can never leave a truncated file
# that later looks complete to the skip check.

set -uo pipefail

SRC="${1:?usage: fetch-attachments.sh <urls.tsv> <dest-dir> [parallel]}"
DEST="${2:?usage: fetch-attachments.sh <urls.tsv> <dest-dir> [parallel]}"
PAR="${3:-4}"

[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
LOG="$DEST/_download.log"
: > "$DEST/_failed.tsv"

export MORGUE_HARVEST_DEST="$DEST"

fetch_one() {
  name="$1"; url="$2"
  dest="$MORGUE_HARVEST_DEST"
  out="$dest/$name"

  if [ -s "$out" ] && unzip -tq "$out" >/dev/null 2>&1; then
    echo "SKIP $name"
    return 0
  fi

  for _ in 1 2 3; do
    if curl -sS -L --fail --max-time 900 --retry 2 --retry-delay 2 \
            -o "$out.part" "$url" 2>/dev/null; then
      # Only accept it if it is actually a readable archive. A CDN error page
      # or a truncated body is a successful HTTP response and a broken zip.
      if unzip -tq "$out.part" >/dev/null 2>&1; then
        mv "$out.part" "$out"
        echo "OK   $name $(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")"
        return 0
      fi
    fi
    sleep 2
  done

  rm -f "$out.part"
  printf '%s\t%s\n' "$name" "$url" >> "$dest/_failed.tsv"
  echo "FAIL $name"
  return 1
}
export -f fetch_one

# Names are slugs and Discord CDN urls are percent-encoded, so neither field can
# contain whitespace -- which makes a flat whitespace-separated stream safe.
#
# Do NOT rewrite this as `xargs -I{}`: with -I the replacement lands inside a
# quoted string and the pairs silently never dispatch. The failure mode is an
# empty log and a run that "finishes" in under a second having done nothing.
tr '\t' '\n' < "$SRC" \
  | xargs -P "$PAR" -n 2 bash -c 'fetch_one "$0" "$1"' \
  > "$LOG" 2>&1

{
  echo "=== DONE ==="
  echo "ok:   $(grep -c '^OK'   "$LOG" || true)"
  echo "skip: $(grep -c '^SKIP' "$LOG" || true)"
  echo "fail: $(grep -c '^FAIL' "$LOG" || true)"
} >> "$LOG"

tail -4 "$LOG"
