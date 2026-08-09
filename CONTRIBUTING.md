# Contributing

Before anything else: **[CLAUDE.md](./CLAUDE.md) is the contract.** It is
written for agents but it is the authoritative description of how this repo
works, and most of it exists because something broke. Read it. The numbered
rules in particular are not style preferences — each one is a bug that shipped.

[SETUP.md](./SETUP.md) gets the thing running. This file is about changing it.

---

## The one rule that is not negotiable

**Never commit the collection.** `items/`, `archives/`, `out/` and `site/` are
gitignored, and that is load-bearing rather than tidy:

- they hold third-party source — paid templates, components licensed for
  personal reference and not redistribution;
- the root [LICENSE](./LICENSE) grants MIT over `fixtures/` and **explicitly
  nothing else**, so moving collected code into `fixtures/` relicenses somebody
  else's paid work under our name, in a file that says we may.

`pnpm test` fails if any fixture's licence is not `own` or `mit`, because
`fixtures/` is now shipped — local mode renders it as the example set on first
run. That check is in `bin/fixtures-build.mjs` and it runs before anything is
built.

Do not add gitignore exceptions. Do not `git add -f`. If you have something
worth sharing, write it from scratch in `fixtures/`.

## Which gate to run

Every one of these runs with no secrets, no database and no network account.
Run the ones your change touches — they are fast, and each one exists because
the thing it checks was once broken in a way nothing else could see.

| You touched | Run | Why |
|---|---|---|
| anything under `bin/` | `pnpm test` | builds, captures and checks the example corpus end to end |
| `web/` | `pnpm verify:web` | a green `next build` says nothing about whether the page runs |
| `proxy.ts`, `lib/share.ts`, `app/s/`, `app/api/share/` | `pnpm verify:share` | the share allowlist, against a real production server |
| `auth.ts`, `lib/users.ts`, `lib/password.ts`, `db/schema.ts`, `app/api/account/*` | `pnpm verify:auth` | starts a throwaway Postgres; every interesting auth bug is a query returning the wrong row |
| `lib/local.ts`, local mode, the installers | `pnpm verify:local` | local mode works, **and cannot be used as an auth bypass** |

`pnpm verify:auth` needs a Postgres. It starts one with `initdb` if you have
Postgres installed; otherwise point it at a throwaway database it may take over:

```bash
MORGUE_TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/scratch pnpm verify:auth
```

A container is enough. It drops and recreates the schema, so it must not be
anything real.

## Things that look like improvements and are not

Each of these has been tried, or was caught in review, and the reason is
written down where the code is.

- **Deleting `proxy.ts` for local mode.** Local mode takes a different branch;
  it does not remove the branch. Rule 6 exists because that gate was once
  silently not running at all, and a "local" edit that deletes it deletes it
  everywhere.
- **Sharing `localMode()`'s check with `authConfigured()`.** They are
  deliberately different shapes — a disjunction and a conjunction — and
  `lib/local.ts` imports nothing so that no refactor elsewhere can widen it.
  The duplication is the feature.
- **Making the share scope a denylist.** Forgetting to deny a new route hands a
  visitor something they should not have, and routes appear faster than that
  list gets reread.
- **Protecting the whole `/api/account` prefix in `proxy.ts`.** It fails the
  other way — it locks out the person who cannot sign in and is trying to reach
  `reset` or `verify`. Both lists are short and both are checked.
- **Swapping the video encoder.** x264 crf28 won a measured comparison; the
  hardware encoder was the worst option of the four. See
  [docs/FINDINGS.md](./docs/FINDINGS.md).
- **Modernising the LRU in `lib/player-pool.ts` into React state.** It is
  ported verbatim from `bin/grid.html` and the grid never runs code.
- **Renaming a file during image optimisation.** Some paths are built with
  template literals and survive minification, so there is no string to rewrite.
  Rule 11.

## Style

Match the file you are in. The two halves of this repo genuinely differ:
`bin/` is terse ESM with few semicolons, `web/` is ordinary TypeScript with
them. Neither is being converted to the other.

**Comments explain why, not what.** The bar is: would the next person delete
this code, or reintroduce the bug, without this comment? If so it earns its
place. If it restates the line below it, it does not.

When you fix something that was subtly wrong, say so where it happened —
including what the wrong version looked like. Half the comments in this repo
are of that shape and they are the ones that have paid off.

## Commits

Present tense, describing the change rather than the activity: *"Make three
gates able to fail"*, not *"fixed stuff"*. If a commit exists because something
was broken, the message should say what was broken.

Do not commit `web/.env.local`, a `.env` of any kind, or anything under the
gitignored trees.
