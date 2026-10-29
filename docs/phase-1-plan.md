# Phase 1 plan — written by the cloud kickoff session, 2026-10-29, before any product code

Scaffold is done and committed (`phase-1`: new-project rewrite, kit, billing removal). Nothing under `src/` beyond the template exists. This is the order Phase 1 would be built in, which donor is read for each port, how the ADR-001 measurement would run in this sandbox, which commands are CI-only, and everything found in the docs that contradicts itself or can't be built as written. **Waiting for Shane's review before task 1.1 starts.**

## Order

TDD order from CLAUDE.md; each step is one or more commits with the failing test written against a committed fixture first.

| Step | Task | Module / files | Tests and gate | Notes |
|---|---|---|---|---|
| 1 | 1.1 scaffold (rest) | `package.json` scripts (`ranking:golden`, `fixtures:check`, `engine:lint`, `engine:eval`), `scripts/engine-lint.ts`, `scripts/engine-eval.ts`, CI job additions | `foundation:drift`, `lint`, `typecheck`; `engine:eval` prints `0 nodes` and exits 0 | `fixtures:check` can't pass until 1.2 lands (contradiction C-1); 1.1 and 1.2 ship in one PR push |
| 2 | 1.2 fixture generator + fixtures | `tools/build_fixtures.py`, `tools/reference_rank.py`, `tools/verify_fixtures.py`, GR- cases in `golden_answers.py`, `fixtures/*.csv`, `fixtures/MANIFEST.json`, brief §5 hashes | two runs byte-identical; `fixtures:check` OK on a clean checkout | Seed 20261029, `T0 = 1793232000`. Fixture table shape proposed below |
| 3 | 1.3 port, with lineage | `scripts/engine-lint.ts` ← Quorum `scripts/tally-lint.ts`; `src/fixtures/csv.ts` ← Quorum `src/tally/csv.ts`; `fixtures:check` script ← Quorum `package.json`; CI `paths-ignore` + `concurrency` ← Quorum `ci.yml` | planted `Date.now()` fails `engine:lint` on a throwaway branch | Quorum is public and already cloned read-only at `/home/claude/shanelabountyai/quorum` |
| 4 | 1.4 rules loader | `src/rules/ranking.ts`, `src/rules/limits.ts` (zod; `RULES_INVALID` naming the field) | negative gravity, missing window, unknown action each refused by name | zod is already a template dependency (check `package.json` first; if not, ask) |
| 5 | 1.5 ranking engine | `src/ranking/hot.ts`, `wilson.ts`, `top.ts`, `order.ts` | GH-01..07, GW-01..08, GT-01..03 at the oracle's tolerances; every `expected_*_order*.csv` row for row | `Math.log10` and `Math.sqrt` only; `round(…, 7)` reproduced as `Math.round(x * 1e7) / 1e7` and pinned by GH-07 |
| 6 | 1.6 tree engine + ADR-001 | `src/tree/path.ts`, `depth.ts`, `thread.ts`, `permalink.ts`; measurement script `scripts/adr-001-measure.ts` (throwaway, kept for the record) | GR- goldens; 8-deep chain renders `[deleted]`/`[removed]` with children intact; deleted leaf omitted but counted; `P-THICK` page 2 starts at top-level 51; continue-thread at depth 6 | Measurement plan below |
| 7 | 1.7 vote reducer | `src/votes/reduce.ts` | every fixture vote row reduces to the fixture's counts; self-downvote and self-unvote refused by code; `GATED_DOWNVOTE` | Pure; account age and contributions are inputs |
| 8 | 1.8 limits engine | `src/limits/window.ts` | young-account 60-in-60 burst allows exactly 2 comments then refuses with `retryAfter`; normal-user script never limited | Sliding window; the foundation's own limiter is fixed-window and DB-coupled (contradiction C-4), so it is a Phase 3 storage donor, not an engine donor |
| 9 | 1.9 `engine:eval` | `scripts/engine-eval.ts` | output table; a swapped pair in a copy of an expected file exits 1 naming the row | |
| 10 | 1.10 `docs/EVAL.md` | | every number next to its command | |
| 11 | 1.11 CI gate | `ci.yml`: `fixtures:check`, `engine:lint`, `ranking:golden`, `engine:eval`, vitest under `TZ=America/Chicago` | one red run (expected row changed on a throwaway branch), one green run, both linked in NEXT.md | CI needs `python3` on the runner (ubuntu-latest has 3.12) |

Then: the "Before Phase 2" gravity check, `docs/phase-2-tasks.md`, NEXT.md, stop.

## Proposed fixture shape (task 1.2; Shane can veto before it's frozen)

`fixtures/users.csv` (id, handle, created_at, contributions_at_T0, banned_until), `boards.csv` (slug, title), `posts.csv` (id, board, author, created_at, title, body_hash), `comments.csv` (id, post_id, parent_id or empty, author, created_at, status ∈ visible|deleted|removed, body_hash), `votes.csv` (voter, node_id, value ∈ +1|−1, cast_at, note: "self" | "brigade-1" | "" ), `expected_post_order_{hot,top_day,top_week,top_all,new}.csv` (rank, post_id, score) at `now = T0 + 7d`, `expected_comment_order_best.csv` (post_id, parent_id, rank, comment_id, score) for `P-THICK`, `P-CHAIN` and three random threads, `expected_counts.csv` (node_id, ups, downs) after reduction, `expected_limits.csv` (script, action, allowed, refused, first_retry_after). Bodies are hashed, not stored, until Phase 3 needs real text for the XSS suite. Named nodes: `P-THICK` (1,000 comments, max depth 11), `P-CHAIN` (8-deep chain; depth-3 author-deleted, depth-5 mod-removed), `C-DEL-LEAF`, `C-REM-LEAF`, the GH posts (`P-GH-50` at T0, `P-GH-5-12H`, `P-GH-5-13H`, `P-GH-5-24H`), the GW comments (`C-GW-1-1`, `C-GW-70-100`, `C-GW-10-10`). One brigade: 7 young accounts downvoting `P-BRIGADE` inside 10 min (all `GATED_DOWNVOTE`, so counts don't move; O-3's queue signal is Phase 4). Depth distribution: geometric, p = 0.45, capped so the long tail reaches 11 in `P-THICK` only.

## ADR-001 measurement (task 1.6) in this sandbox

The sandbox has Postgres **16.15** (started with `service postgresql start`; CI and the stack say 17). Plan: a throwaway database `commons_adr`, two tables built from the same `P-THICK` fixture, (a) materialized path `comment(id, post_id, path text, depth int)` with a `text_pattern_ops` index and `WHERE path LIKE $1 || '%'`, (b) closure `comment_closure(ancestor, descendant, depth)` with a join; full-subtree fetch of the post's 1,000 comments, median and p95 of 20 runs each via `EXPLAIN (ANALYZE, BUFFERS)`, after one warm-up. Record both numbers, the PG version and the caveat that the real measurement is Phase 2's on the Prisma schema. If PG 16 vs 17 is unacceptable for the decision, the ADR stays "proposed, default materialized path" and Phase 2 decides on CI's Postgres 17.

## CI-only (cannot run here)

- `foundation:check-modules` (needs `rsync`).
- `prisma migrate deploy` / `migrate diff` (the schema engine can't download; `psql -f` stood in locally).
- Playwright e2e against the production build: Chromium exists at `/opt/pw-browsers`, so this may run; untested until Phase 4 has pages.
- Everything else ran locally (D-20): drift, lint, typecheck, vitest 189/189.

## Contradictions and things that can't be built as written (not resolved here)

| # | Where | What | Suggested resolution (Shane decides) |
|---|---|---|---|
| C-1 | `docs/phase-1-tasks.md` 1.1 vs CLAUDE.md commands | 1.1 says `fixtures:check` must exist and "every command runs", but it calls `tools/verify_fixtures.py`, which 1.2 writes. `fixtures:check` cannot pass between 1.1 and 1.2. | Let 1.1 create the script and accept a red `fixtures:check` until 1.2, or merge 1.1 and 1.2 into one acceptance. |
| C-2 | CLAUDE.md §Session 0 vs D-19 | §Session 0 tells a cloud session to record "Reuse scan skipped"; the scan was run on the Mac (D-19), so the sentence is stale and KICKOFF.md step 5 in the repo still says "skipped" (Shane's pasted version was corrected). | Rewrite §Session 0 to "scan ran 2026-10-29, re-run when the repo is next opened on the Mac" and update KICKOFF.md step 5. |
| C-3 | D-4 / CLAUDE.md "PostgreSQL 17" vs sandbox | The sandbox's Postgres is 16.15; CI is 17. Any local measurement (ADR-001) is on 16. | Accept 16 for the Phase 1 measurement with the version recorded, or defer the decision to Phase 2 on CI. |
| C-4 | `docs/portfolio-overlap.md` "rate limiting: No. The foundation has auth rate limits on sign-in only" | Inaccurate: `src/core/rate-limit.ts` is a general fixed-window Postgres counter (`hit(key, {limit, windowMs})`) used by login, MFA, invites and share reads, with a `RateLimit` table and an hourly sweep. It is not a sliding window and not pure, so it isn't an engine donor, but it is the obvious Phase 3 storage donor. | Correct the overlap row: "Partly (foundation fixed-window counter; storage donor for Phase 3)". |
| C-5 | `rules/limits.json` `young_account.max_age_hours` / `max_contributions` vs D-15 "under 24 h **or** fewer than 5" | The keys are maxima by name but D-15 uses strict "under"/"fewer than"; the boundary (exactly 24 h old, exactly 5 contributions) isn't pinned by a golden case. | Add GL- goldens for the two boundaries in 1.2 (young at 23:59:59, not young at 24:00:00; young at 4, not at 5) and rename the keys `young_below_hours` / `young_below_contributions`, or keep the names and document strictness in the brief. |
| C-6 | D-9 tiebreak "(created_at desc, id asc)" vs R-3 New | For New, `created desc` is the sort itself, so the tiebreak reduces to `id asc`; for Hot/Top/Best the tiebreak is as written. Not wrong, but the brief should say the New sort's tie rule is `id asc` alone to avoid an implementer applying it twice. | One sentence in R-3. |
| C-7 | PRD P0-4 "sliding-window limits" vs 1.8 acceptance "allows exactly 2" | A true sliding window over 60 s with a 60-in-60 burst allows 2 then refuses for the rest of the minute, so "exactly 2" holds; but `retryAfter` for a sliding window depends on the oldest hit's age, which the task doesn't state. | Define `retryAfter = (oldest_counted_hit + per_seconds) − now` in the brief and pin it with a golden case. |
| C-8 | Task 1.2 "GH/GW cases embedded as real posts" vs the oracle | GH-07 pins `hot(50, 0, T0)` with 50 **ups** and 0 downs; as a real post the author's self-upvote (D-12) is one of the 50, so the fixture must seed 49 other voters, not 50. Same for GW: `C-GW-1-1` is the author's own vote only. | State it in the generator and in the brief §4 table. |

## Donor paths not readable from this session

- **Handhold** (`~/Projects/alongside`, D-19): Mac-local, not on GitHub under a name this session can reach. Needed before 1.3's moderation vocabulary; Phase 1 has no moderation code, so this blocks nothing yet.
- **Pulseboard, Housefile, Adjuster** (private): referenced in `docs/portfolio-overlap.md` for batch recompute, append-only triggers and state machines, all Phase 2+. Quorum (public) carries ports of the same patterns and is readable.
- **Bracketry** (private): the pure-engine layout; Quorum's `src/tally/` is the same pattern and is readable.

## Defaults this session would take if Shane says go (each reversible)

- zod for the rules loader (already a template dependency, `zod ^4.6.5`; no new dependency).
- Own CSV reader ported from Quorum (no dependency).
- Hashes of fixture bodies, not bodies, until Phase 3 (keeps the public repo free of filler prose and keeps diffs small).
- ADR-001 measured on Postgres 16 with the caveat recorded (C-3), unless told otherwise.
