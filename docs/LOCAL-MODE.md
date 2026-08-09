# Local mode — open-sourcing morgue for people who are not you

Status: **design, nothing built.** Written 2026-08-09 to be handed to another
agent and picked up cold.

Read [CLAUDE.md](../CLAUDE.md) first — it is the folder contract and it is
authoritative. [MULTI-TENANT.md](./MULTI-TENANT.md) is the *hosted* product;
this document is the opposite direction and the two must not be conflated.
Where they disagree about a default, local mode loses: the hosted deployment is
the one with other people's data in it.

---

## 1. What is being asked for

> "Make sure this open source project allows people to easily replicate morgue
> locally for themselves — disabling production loaded bloat, easy installation
> for people and designers who aren't the most extremely technical, so a very
> simple script or something cross-platform, or an agent handover script like
> Claude Code, and without authentication for the local version."

So: **one command, on macOS/Windows/Linux, that leaves a designer looking at
their own morgue in a browser, with no account, no cloud services, and no
config file to edit.**

## 2. Read this before designing anything

Three facts decide most of the design, and two of them are easy to miss.

> [!IMPORTANT]
> **The collection cannot ship.** `items/`, `out/`, `site/` and `archives/` are
> gitignored deliberately — they hold paid third-party CodeGrid templates
> (every current item is `license: "paid"`). A public repository ships with an
> **empty** collection. The first-run experience is therefore an empty grid,
> and that is a product problem, not an oversight. See §7.

> [!WARNING]
> **The hard part is not the code, it is ffmpeg and a browser engine.** The
> capture pipeline shells out to `ffmpeg` (`bin/capture.mjs`) and drives a real
> Chrome through Playwright. Between them that is a few hundred megabytes and
> the single most likely point of failure for a non-technical user — and
> `bin/capture.mjs` currently does **no preflight check at all**, so a missing
> ffmpeg surfaces as a spawn ENOENT partway through a capture. Fixing that is
> item 1 of phase 1 and it is worth more than any installer polish.

**Auth is already the easy half.** `proxy.ts` fails open in development by
design (rule 9), so a local run with no `AUTH_SECRET` already requires no
sign-in. Local mode does not need to *remove* authentication; it needs to make
that existing behaviour explicit and intentional rather than a side effect of a
missing variable. Do not delete the gate — see §5.

## 3. What "production bloat" actually is

Measured against the current tree, not assumed. A local user needs none of it:

| Thing | Why it is there | Local |
|---|---|---|
| `@neondatabase/serverless`, `pg`, `drizzle-orm` | accounts, waitlist, share links | **off** — no accounts |
| `next-auth`, `@auth/drizzle-adapter` | three sign-in providers | **off** |
| `@aws-sdk/client-s3`, `s3-request-presigner` | R2 storage and signed URLs | **off** — read `site/` from disk |
| `resend` | verification and reset email | **off** |
| `/admin`, `/signin`, `/reset`, `/verify`, `/account`, `/s/[token]`, `/api/waitlist`, `/api/share`, `/api/account/*` | the hosted product | **not routed** |
| The landing page (`/`) with waitlist form | marketing | **replaced** by a redirect to `/vault` |
| `MORGUE_DATA_SOURCE=r2` | production data path | forced to `local` |

Everything a local user *does* need is already the default: `MORGUE_DATA_SOURCE`
defaults to `local`, and `lib/vault-data.ts` reads `../site/data` from disk.

**Do not fork the app to achieve this.** A second copy of `web/` diverges within
a month and every bug gets fixed twice. Use one flag — `MORGUE_LOCAL=1` — and:

- a route group or an early `notFound()` for the hosted-only pages;
- **dynamic `import()` for every cloud dependency**, so the module is never
  pulled into the bundle when the flag is set. `lib/vault-data.ts` already does
  exactly this for R2 (`await import("./r2")`), which is the pattern to copy.

Measure the win rather than asserting it: record `next build`'s reported route
sizes and `node_modules` size before and after, and put the numbers in
[FINDINGS.md](./FINDINGS.md). If the saving is small, say so — the honest
outcome may be that "bloat" was mostly server-only code that never reached the
browser anyway, in which case the real deliverable is §4 and §7.

## 4. The installer

The user is a designer. Assume no Node, no package manager, no terminal
fluency, and no patience for a README with eleven steps.

**Target: one line to paste, then one command.**

```
macOS / Linux    curl -fsSL https://<host>/install.sh | sh
Windows          irm https://<host>/install.ps1 | iex
```

Two scripts, not one, and no attempt to be clever about it: a POSIX `sh` script
and a PowerShell script are each about eighty lines and both are readable.
Cross-platform "universal" installers written in Node cannot run before Node
exists, which is the whole problem.

Each script must:

1. **Check, then install, then verify** — Node ≥ 22 (Node 24 preferred; the
   scripts under `bin/` rely on native `.ts` type stripping), `pnpm` via
   corepack, `ffmpeg`, and Playwright's Chrome.
2. **Use the platform's own package manager** where one exists — Homebrew,
   winget, apt/dnf — and fall back to a direct download. Never silently install
   a package manager the user did not ask for; offer it and wait.
3. **Say what it is about to do before doing it**, print the disk cost, and
   exit cleanly on refusal.
4. **Be idempotent.** Re-running must be safe and fast, because the first thing
   a stuck person does is run it again.
5. **Fail with a sentence, not a stack trace.** "ffmpeg didn't install — here
   is the one command to run" beats any diagnostic.

Then `pnpm morgue` (a new script) does: install deps if missing → build the
site → start the server → open a browser. One word, and the first run explains
itself.

**The agent-handover alternative is worth building too, and it is cheaper.** A
`SETUP.md` written for an agent rather than a human — "you are setting up
morgue on this machine; here are the prerequisites, the checks, and the
failure modes" — lets anyone with Claude Code paste one sentence and have the
environment sorted, and it doubles as the spec the shell scripts implement.
Write it first and derive the scripts from it.

## 5. Auth in local mode — what NOT to do

The tempting move is to strip `proxy.ts` out. Do not.

- `proxy.ts` is what makes the hosted deployment safe, and rule 6 exists
  because it was once silently not running at all. A local mode that deletes it
  invites a merge that deletes it everywhere.
- Its dev behaviour is *already* open. `MORGUE_LOCAL=1` should take the same
  branch the missing-config path takes today, but deliberately and with a
  different log line — "local mode: no accounts, everything open" rather than a
  warning about unset variables.

**The asymmetry must survive.** `MORGUE_LOCAL` must be ignored when
`NODE_ENV=production` on a hosted deploy, or it becomes an authentication
bypass one environment variable wide. Assert that in `pnpm verify:share`, which
already spawns a production server and is the right place to prove a flag does
*not* work.

## 6. Verification

Local mode is a supported configuration, so it gets a gate like everything
else (rules 10, 12, 13).

- **`pnpm verify:local`** — boots with `MORGUE_LOCAL=1` and no other variables
  at all, and asserts: `/vault` opens with no session; `/admin`, `/account`,
  `/api/share` are 404 rather than merely gated; nothing imports the S3, Neon
  or Resend clients; `pnpm check` still passes.
- **A cold-machine test.** Nothing else in this document is believable without
  it. A fresh VM or container per platform, running only the install line. This
  is the acceptance test, and "it worked on the machine that already had
  ffmpeg" is not it.

## 7. The empty-collection problem

A designer runs the installer, opens the vault, and sees nothing. That is the
default experience of an open-source morgue and it needs an answer.

`fixtures/` is the answer, and it is already there: **11 fixture items, every
one of them `license: "own"`** — checked, not assumed — written from scratch
for this repo, committed, and therefore the only content in the tree that can
legally be redistributed. `pnpm test` already builds and captures them. So
first run should populate the vault from `fixtures/` and label them plainly as
examples.

Two things follow. `fixtures/` stops being test-only and becomes a shipped
artefact, which turns CLAUDE.md's "only for items written from scratch for this
repo" from a tidiness rule into a licensing one — the moment something
third-party lands there, the distribution is infringing. Add a check to
`pnpm test` that fails if any fixture's licence is not `own`. And the
onboarding
should end by *adding* something: the shortest path from an empty vault to
"this tool is mine" is one item the user chose, so first run should offer to
ingest a URL as `kind: "reference"` — the cheapest ingest in the contract, and
[MULTI-TENANT.md](./MULTI-TENANT.md) §7 is building that path anyway.

## 8. Phases

| # | Phase | Gate |
|---|---|---|
| 1 | Preflight checks in `bin/capture.mjs` and a `pnpm doctor` that names every missing prerequisite at once | Deleting ffmpeg from PATH produces one clear sentence, not an ENOENT |
| 2 | `MORGUE_LOCAL=1`: hosted routes off, cloud clients behind dynamic imports, `/` → `/vault` | `pnpm verify:local`; before/after sizes in FINDINGS.md |
| 3 | `SETUP.md` for an agent, then `install.sh` and `install.ps1` derived from it | Cold VM per platform, install line only |
| 4 | `pnpm morgue` one-command run, and first-run seeding from `fixtures/` | A non-technical person, unaided, reaches a populated vault |
| 5 | Public-repo hygiene: LICENCE, CONTRIBUTING, an `.env.example` with everything optional, and a README that leads with the local path rather than the hosted one | A fresh clone with no secrets runs |

## 9. Decisions needed before phase 2

1. **Is local mode the same repository, or a separate distribution?** This
   brief assumes one repo and one flag. A separate package is easier to make
   pleasant and much harder to keep working.
2. **Does local mode keep the capture pipeline, or only browse?** Capture is
   what makes morgue morgue, and it is also the entire ffmpeg/Playwright
   burden. A browse-only local mode installs in seconds. A capturing one is the
   real tool. Possible answer: install browse-only, offer capture as a second,
   clearly-priced step.
3. **What licence?** It decides whether §7's fixtures can ship and what anyone
   may do with the pipeline. Nothing else in phase 5 can be written until this
   is answered.
