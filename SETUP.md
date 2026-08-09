# Setting up morgue on this machine

**This file is written for an agent** — Claude Code, or anything else that can
run commands and read output. If you are a person, you can read it too, but you
probably want [the README](./README.md), which is shorter.

If you have an agent, the whole setup is one sentence:

> Set up morgue on this machine following SETUP.md, then run `pnpm morgue`.

Everything below is what that sentence expands to. It is also the specification
`install.sh` and `install.ps1` implement — if you change one, change all three.

---

## What you are building

A **local morgue**: one person, one machine, no accounts, nothing leaving the
computer. No database, no cloud storage, no sign-in. `pnpm morgue` ends with a
browser open on a grid.

Read [CLAUDE.md](./CLAUDE.md) before adding anything to a collection — it is
the folder contract and it is authoritative. This file only covers getting the
tool to run.

## Two tiers, and you should know which one you are doing

|  | Needs | Rough cost |
|---|---|---|
| **Browse** | Node, pnpm | ~600 MB of `node_modules` |
| **Capture** | the above, plus ffmpeg and Playwright's Chrome | ~+400 MB, and ffmpeg |

Browsing an existing morgue, searching it, reading the notes and exporting a
bundle all work without the capture tier. **Recording new previews does not.**

Do not install the capture tier by reflex. It is most of the download and the
only part that reliably fails, and someone who just wants to look at a
collection never needs it. `pnpm doctor` reports the two tiers separately for
this reason.

## Steps

### 1. Node 22 or newer

Node 24 is what this repo is developed on. Below **22.18** the verification
scripts under `bin/` cannot import the app's TypeScript modules — they rely on
Node stripping types, which is on by default from 22.18.

```bash
node --version
```

| Platform | Install |
|---|---|
| macOS | `brew install node` |
| Windows | `winget install OpenJS.NodeJS.LTS` |
| Debian/Ubuntu | `sudo apt-get install -y nodejs` (check the version — distro packages lag; use [nodesource](https://github.com/nodesource/distributions) if it is below 22) |
| Fedora | `sudo dnf install nodejs` |
| Arch | `sudo pacman -S nodejs` |

### 2. pnpm

Ships with Node. Do not install it separately.

```bash
corepack enable pnpm
pnpm --version
```

### 3. Dependencies

From the repository root. **Not from `web/`** — running there fails with
`ERR_PNPM_IGNORED_BUILDS` (CLAUDE.md rule 7).

```bash
pnpm install
```

### 4. Check before going further

```bash
pnpm doctor
```

This names **every** missing prerequisite at once, with the exact command to
fix each one on this platform. Do not skip it and do not work around it one
error at a time — that is the failure mode it exists to remove.

It exits 0 when browsing will work, and reports the capture tier separately.

### 5. Capture tier — only if you are recording previews

```bash
pnpm doctor --capture     # exits 1 while anything is missing
```

**ffmpeg.** `pnpm doctor` checks that ffmpeg can encode h.264, not merely that
it exists. Those differ: Fedora's default `ffmpeg-free` is a real ffmpeg built
without libx264, so it passes every presence check and then fails at the
encode. If you see *"installed, but built without libx264"*, that is what
happened.

| Platform | Install |
|---|---|
| macOS | `brew install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |
| Debian/Ubuntu | `sudo apt-get install -y ffmpeg` |
| Fedora | `sudo dnf install ffmpeg --allowerasing` (needs [RPM Fusion](https://rpmfusion.org/)) |
| Arch | `sudo pacman -S ffmpeg` |

Do not substitute another encoder to get around this. Which one to use was
measured — see [docs/FINDINGS.md](./docs/FINDINGS.md), *"the hardware encoder
was the worst option"*.

**Chrome.** Playwright downloads its own, about 400 MB:

```bash
pnpm exec playwright install chromium
```

### 6. Run it

```bash
pnpm morgue
```

Builds what needs building, starts a server, opens a browser. First run takes a
couple of minutes because the app is compiled once; after that it is seconds.

`items/` is empty in a fresh clone — the collection is gitignored on purpose,
because it holds third-party licensed source. So the first run shows the
**examples that ship with the repo** (`fixtures/`, 11 items, all written from
scratch here and MIT-licensed). Put your own work in `items/<slug>/` and it
takes over.

## Troubleshooting

**`pnpm morgue` says this machine is configured as a hosted morgue.**
`AUTH_SECRET`, `DATABASE_URL` or an OAuth id is set — in `web/.env.local` or in
your shell. Local mode is refused whenever anything says "this deployment has
accounts", because otherwise one environment variable would switch off the
sign-in gate on a real deployment. Move the file aside, or run the hosted app
with `pnpm web:dev` instead. See `web/src/lib/local.ts`.

**Every card says "not captured".** Nothing has been recorded yet. Either the
capture tier is not installed (`pnpm doctor --capture`) or you have not run
`pnpm capture`. The vault still works — search, filters, notes and export are
all unaffected.

**A card's preview is wrong, or frozen.** Look at `out/<slug>/preview.mp4` and
`out/<slug>/contact.jpg` before trusting it. `motion: OK` in the capture log
proves pixels changed, not that the effect ran (CLAUDE.md rule 5).

**Port already in use.** `pnpm morgue --port 4000`.

**Something is stale.** `pnpm morgue --rebuild` redoes the collection and the
app build.

## Verifying a setup

None of these need secrets, a database or a network:

```bash
pnpm doctor          # this machine
pnpm verify:local    # local mode works, and cannot be used as an auth bypass
pnpm test            # the example corpus, end to end (needs the capture tier)
```

`pnpm test` is the only one that needs ffmpeg. If it fails at the capture step
with a libx264 message, that is step 5, not a broken repo.

## What this setup deliberately does not do

- **It does not write secrets.** Nothing here creates `web/.env.local` or
  generates an `AUTH_SECRET`. A local morgue has no accounts, so it needs
  neither.
- **It does not disable the authentication gate.** `proxy.ts` still runs, and
  still refuses everything on a deployment that has accounts. Local mode takes
  a different branch; it does not remove the branch. Do not "simplify" this by
  deleting the gate — CLAUDE.md rule 6 exists because it was once silently not
  running at all.
- **It does not send anything anywhere.** No telemetry, no upload, no account.
  `pnpm publish:r2` exists for the hosted deployment and is never invoked by
  any of the above.
