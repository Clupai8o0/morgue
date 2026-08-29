#!/usr/bin/env python3
"""verify-harvest.py <dest-dir> [inventory.json]

Proves a harvest actually landed, and writes MANIFEST.csv next to the archives.

Three checks, because each catches something the others cannot:

  integrity  every archive opens and every member passes a CRC check
  coverage   every row of the inventory has a file on disk
  size       every file matches the byte size Discord displayed for it

The size check is the one that catches a silently-truncated download that still
happens to be a readable zip. It compares against the ORIGINAL display string
("3.17 KB"), not a float rounded to megabytes -- rounding a KB-sized file to 2dp
of MB throws away three digits and reports dozens of phantom mismatches.
"""
import csv
import json
import os
import re
import sys
import zipfile
from collections import Counter

UNITS = {"KB": 1024, "MB": 1024**2, "GB": 1024**3}


def to_bytes(s):
    m = re.match(r"([\d.]+)\s*([KMG]B)", s or "", re.I)
    return float(m[1]) * UNITS[m[2].upper()] if m else None


def classify(path):
    """What kind of morgue item this archive would become."""
    try:
        names = [n.lower() for n in zipfile.ZipFile(path).namelist()
                 if not n.startswith("__MACOSX")]
    except Exception:
        return "unreadable"
    has_pkg = any(n.endswith("package.json") for n in names)
    is_next = any(
        "/app/" in n or "/pages/" in n or n.endswith(("next.config.js", "next.config.mjs"))
        for n in names
    )
    if has_pkg and is_next:
        return "project"       # needs a build -- CLAUDE.md rule 2 applies
    if has_pkg:
        return "node"
    if any(n.endswith(".html") for n in names):
        return "static"
    return "other"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dest = sys.argv[1]
    inv_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(dest, "inventory.json")

    files = sorted(f for f in os.listdir(dest) if f.endswith(".zip"))
    if not files:
        sys.exit(f"no .zip files in {dest}")

    inv = {}
    if os.path.exists(inv_path):
        data = json.load(open(inv_path))
        inv = {i["n"]: i for i in data["items"]}
    else:
        print(f"! no inventory at {inv_path} -- size and coverage checks skipped")

    corrupt, mismatched, kinds, rows = [], [], Counter(), []
    total = 0

    for f in files:
        p = os.path.join(dest, f)
        size = os.path.getsize(p)
        total += size

        try:
            bad = zipfile.ZipFile(p).testzip()
            if bad is not None:
                corrupt.append((f, f"bad member: {bad}"))
        except Exception as e:
            corrupt.append((f, str(e)[:60]))

        n = int(f.split("-")[0]) if f[:4].isdigit() else None
        it = inv.get(n)
        kind = classify(p)
        kinds[kind] += 1

        if it:
            want = to_bytes(it.get("size"))
            if want is not None:
                # Discord shows 2 decimals, so tolerate half a display unit.
                unit = UNITS["KB"] if "KB" in it["size"].upper() else UNITS["MB"]
                if abs(size - want) > 0.005 * unit + 1:
                    mismatched.append((f, it["size"], size))
            rows.append((n, it["date"], it["size"], kind, f, it["title"]))
        else:
            rows.append((n, "", "", kind, f, ""))

    missing = [n for n in inv if not any(f.startswith(f"{n:04d}-") for f in files)]

    manifest = os.path.join(dest, "MANIFEST.csv")
    with open(manifest, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["n", "date", "size", "kind", "filename", "title"])
        w.writerows(sorted(rows, key=lambda r: (r[0] is None, r[0])))

    print(f"archives   {len(files)}  ({total / 1024**3:.2f} GB)")
    print(f"integrity  {len(files) - len(corrupt)}/{len(files)} pass")
    if inv:
        print(f"coverage   {len(inv) - len(missing)}/{len(inv)} inventory rows on disk")
        print(f"size       {len(files) - len(mismatched)}/{len(files)} match Discord's reported bytes")
    print("kinds      " + ", ".join(f"{k}={v}" for k, v in kinds.most_common()))
    print(f"manifest   {manifest}")

    for f, why in corrupt[:10]:
        print(f"  CORRUPT  {f}: {why}")
    for f, want, got in mismatched[:10]:
        print(f"  SIZE     {f}: expected {want}, got {got} bytes")
    for n in missing[:10]:
        print(f"  MISSING  row {n}")

    failed = os.path.join(dest, "_failed.tsv")
    if os.path.exists(failed) and os.path.getsize(failed):
        print(f"  ! {sum(1 for _ in open(failed))} rows in _failed.tsv -- re-run fetch-attachments.sh")

    sys.exit(1 if (corrupt or mismatched or missing) else 0)


if __name__ == "__main__":
    main()
