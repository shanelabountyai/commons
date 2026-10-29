# CLAUDE.md — Commons

Learning project: a synthetic homelab community forum. Boards, posts, and comments nested arbitrarily deep; Hot/Top/New/Best ranking; one account, one vote; rate limits and young-account gates as data; reports, a mod queue and an append-only mod log. It's the first project in the portfolio designed against hostile users. **Synthetic data only. No scraped content, no real users. Passing the abuse fixtures shows the defenses stop the attacks the author thought of, nothing more.** Keep the scope-honesty banner from `prd-commons.md` verbatim in README.md.

Read first: `prd-commons.md` (what), `docs/decisions.md` (authoritative; outranks the PRD), `docs/domain-brief.md` (vocabulary, tree rules T-, ranking formulas R-, golden-case index), `docs/adr-001-tree-storage.md`, `docs/portfolio-overlap.md` (what to port). Current work: `docs/phase-1-tasks.md`. Session state: `NEXT.md`.

## Non-negotiables
1. **All user content is untrusted at every render.** Output-encode everywhere; markdown through an allowlisted subset only; links `rel="nofollow ugc noopener"`; no `dangerouslySetInnerHTML` outside the one sanitizer module. The XSS fixture set is written **before** the renderer (Phase 3).
2. **Tree writes only via the tree module** (`src/tree/`). Nothing else computes a path, depth or parent.
3. **Counts are denormalized caches; vote rows are truth.** `votes:verify` recomputes from rows and must be clean.
4. **One account, one vote per node,** enforced by a database unique constraint, not by application checks alone. The author's +1 is fixed (D-12).
5. **Engines are pure.** `src/tree/`, `src/ranking/`, `src/votes/`, `src/limits/` import no database, clock, randomness, network or model client; `now` is a parameter (D-7). `npm run engine:lint` enforces it.
6. **Constants are data.** Ranking constants live in `rules/ranking.json`, limits in `rules/limits.json`. Changing one needs a `docs/decisions.md` entry and a golden case.
7. **Every abuse technique that works once becomes a fixture** before it's fixed.
8. **Fixtures are frozen.** Generated once by `tools/build_fixtures.py --seed 20261029` and `tools/reference_rank.py --write-expected`; `fixtures:check` must be OK in CI. Product code never writes to `fixtures/`.
9. **Never edit an expected value to pass a test** (D-10). If TypeScript disagrees with the oracle, stop and show both derivations.
10. **Say what the numbers mean.** Never "secure", "spam-proof", "fair" or "fast" without the number and the scope banner's limits. Nothing is sent: notices stop in the outbox.

## Working rules
- **TDD order:** Wilson + hot math (GH/GW/GT) → rules loader → tree path + render rules (GR) → vote reducer → limits engine → `engine:eval` → (Phase 2) schema, constraint, `votes:verify`, batch ranking → (Phase 3) XSS fixtures, then renderer, then limits wired → (Phase 4) moderation, UI, P1. Write the failing test against a committed fixture first.
- `tools/*.py` are test oracles, not product code. Write the TypeScript from `docs/domain-brief.md`, not by porting the Python line by line.
- **Port before you write.** Donors in `docs/portfolio-overlap.md`. Record lineage in `docs/decisions.md`.
- Phase gate: don't start the next phase until the current phase's exit criteria pass. Write the next phase's task list at the gate and **stop for review.**
- Small commits, one concern each, naming specific files (never `git add -A`). Branch + PR; **never merge.** Note seams for non-goals but don't build them.
- **Ask before adding dependencies.** Ask-before-add list: any markdown parser or sanitizer (Phase 3 will need one; propose it with the reason), any CSV parser, any rate-limit library, any date library, any tree/graph library, any charting library.
- **Cloud session:** the sandbox may not download Prisma engines or Playwright browsers. Try Quorum's workarounds first (D-16). Record what couldn't run in NEXT.md; **CI decides.**
- **Model is pinned to Claude Fable 5.1 (`claude-fable-5-1`)** in `.claude/settings.json` (D-17).
- End each session by updating NEXT.md: what was built, decided, left open, and the gate output.

## Session 0 — reuse check
The house reuse scan (`~/Projects/reuse-scan.py`) ran on the Mac on 2026-10-29 (D-19; Handhold found as the moderation donor). A cloud session can't run it: don't record "skipped", point at D-19. Re-run it when the repo is next opened on the Mac and before Phase 4.

## Stack
TypeScript on a clone of saas-foundation **v1.4.0**: Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright. **Port 7500** (D-5, verified free in the port table 2026-10-29). Foundation modules per D-18. Template-owned paths (`src/core/**`, `tests/invariants/**`, core migrations, security routes) are never edited here; `npm run foundation:drift` enforces it. Local `DATABASE_URL`s carry `?connection_limit=10&pool_timeout=20`. `vercel.json` carries the house `ignoreCommand` even though no deploy is planned. CI runs with `TZ=America/Chicago`. Python only in `tools/` (stdlib only, `python3 -I`).

## Commands (create in task 1.1)
- `npm test`: vitest (engine tests need no database)
- `npm run ranking:golden`: `python3 -I tools/golden_answers.py`, must end `OK`
- `npm run fixtures:check`: `python3 -I tools/verify_fixtures.py && python3 -I tools/golden_answers.py && git diff --exit-code fixtures/ && test -z "$(git status --porcelain fixtures/)"`
- `npm run engine:lint`: greps the four engine dirs for `Date.now`, `new Date(`, `Math.random`, `prisma`, `fetch`, `anthropic`, `@/core`; validates both rules files
- `npm run engine:eval`: runs the engines over `fixtures/`, prints the brief's eval table, and exits non-zero naming the first disagreement
- Phase 2: `npm run votes:verify`, `npm run rank:recompute`
- Phase 3: `npm run abuse:spam`, `npm run abuse:normal`, `npm run xss:check`

## Definition of done (any task)
Tests green (or recorded as CI-only with the reason), `engine:eval` agreeing with every expected file, `fixtures:check` OK, `engine:lint` OK, decisions doc updated if a rule changed, NEXT.md updated, numbers (not adjectives) in the commit message when a measurement changed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
