# Commons — Phase 1 evaluation

Every number here is printed by the command named next to it, on the frozen fixtures (seed 20261029, `fixtures/MANIFEST.json`), on 2026-10-29. Read the scope banner in `README.md` first: these numbers say the TypeScript engines agree with the Python oracle on fixtures the same author generated, under the published formulas with the constants in `rules/`. They say nothing about real users, real spam, or whether the rankings are good.

## Oracle agreement — `npm run engine:eval`

| Expected file | Rows | Matched | What it proves |
|---|---|---|---|
| `expected_post_order_hot.csv` | 497 | 497 | R-1 hot ordering, scores within 1e-7 |
| `expected_post_order_top_day.csv` | 14 | 14 | R-2 window edge: `P-DAY-EDGE-IN` (exactly 24 h) in, `P-DAY-EDGE-OUT` (24 h + 1 s) out |
| `expected_post_order_top_week.csv` | 102 | 102 | R-2 |
| `expected_post_order_top_all.csv` | 497 | 497 | R-2 with no lower bound; 3 removed posts excluded |
| `expected_post_order_new.csv` | 497 | 497 | R-3 with the `id asc` tie rule (C-6) |
| `expected_comment_order_best.csv` | 1,612 | 1,612 | R-4 Wilson per parent group over 6 threads, scores within 5e-5 |
| `expected_counts.csv` | 5,500 | 5,500 | V-5 counts after reducing 10,607 events |
| `expected_vote_outcomes.csv` | 10,607 | 10,607 | V-1..V-4: 10,570 applied, 11 toggled off, 9 switched, 5 `SELF_VOTE`, 12 `GATED_DOWNVOTE` (7 brigade + 5 planted), 0 unknown |
| `expected_tree.csv` | 231 | 231 | T-2..T-6 and D-13 on `P-CHAIN` page 1 and `P-THICK` pages 1–2: 3 continue-thread links, 2 `[removed]`, 2 `[deleted]` in place |
| `expected_pages.csv` | 2 | 2 | `P-CHAIN` 11 comments → 2 top-level shown (two dead leaves hidden); `P-THICK` 1,000 → 408 shown, 9 pages |
| `expected_permalink.csv` | 3 | 3 | T-5: `C-CHAIN-7` has 7 ancestors; `C-THICK-DEEP-11` has 11; `C-DEL-LEAF` renders nothing |
| `expected_limits.csv` | 6 | 6 | L-3/L-4 below |

Total: 12 files, 19,568 rows, 0 differences.

## Limit scripts — part of `npm run engine:eval`

| Script | Attempts | Allowed | Refused | First retryAfter |
|---|---|---|---|---|
| spam-young-comments (60 at 1/s) | 60 | 2 | 58 | 58 s |
| spam-young-posts (20 at 1/min) | 20 | 1 | 19 | 3,540 s |
| spam-young-votes (100 at 1/s) | 100 | 20 | 80 | 50 s |
| normal-u050-posts | 2 | 2 | 0 | — |
| normal-u050-comments | 29 | 29 | 0 | — |
| normal-u050-votes | 55 | 55 | 0 | — |

The 20-of-100 result is the sliding window doing its job: ten allowed, fifty refused, then the first ten leave the window and ten more are allowed. `u050` is one ordinary fixture user replayed through every window; no limit fires.

## Golden cases — `npm run ranking:golden`

`44 cases OK`: GH-01..07 (hot, decay crossover), GW-01..08 (Wilson small samples), GT-01..03 (window edges), GR-01..12 (segments, paths, D-13, render cut, pagination), GL-01..14 (gate boundaries, sliding window, retryAfter). The same cases run in TypeScript under `npm test` (`tests/engine/`, 42 tests).

## Purity — `npm run engine:lint`

`OK (4 files under src/tree, src/ranking, src/votes, src/limits clean; rules/ranking.json valid (gravity 45000s, z 1.959963984540054); rules/limits.json valid (4 windows))`. A planted `Date.now()` in `src/ranking` on a throwaway copy fails it (task 1.3 acceptance).

## Fixtures — `npm run fixtures:check`

`OK: 17 files match MANIFEST.json; 12 expected files reproduce from the inputs`. Two generator runs give identical bytes.

## ADR-001 measurement — `npx tsx scripts/adr-001-measure.ts`

PostgreSQL 16.15 (sandbox; CI is 17, D-22), `P-THICK` 1,000 comments, 20 runs after one warm-up, `EXPLAIN (ANALYZE, BUFFERS)`:

| Query | Materialized path | Closure table |
|---|---|---|
| Whole thread, median / p95 | 0.808 / 0.871 ms | 1.341 / 1.390 ms |
| Permalink subtree (12 rows), median / p95 | 0.036 / 0.068 ms | 0.178 / 0.206 ms |
| Storage, table + indexes | 232 KiB | 672 KiB |

Everything fit in shared buffers (`read 0`), so this measures plan shape and CPU, not I/O. Decision and caveats: `docs/adr-001-tree-storage.md`.

## Negative proofs

- Swapping two rows in a copy of `expected_post_order_top_all.csv`: `engine:eval` exits 1 with `row 3 rank: expected 3, actual 2`.
- Changing `gravity_seconds` to 90000 in a copy of `rules/ranking.json` (the "Before Phase 2" check): `expected_post_order_hot.csv` goes to 0/497 and is named first; the other 11 files stay green. No code changed.
- CI red run (one committed swapped row, throwaway branch `gate-proof-red`, PR #2) and the green run on the Phase 1 head are linked in `NEXT.md`.

## Template gate — unchanged by Phase 1

`npm test` 231/231 (39 files; 189 template + 42 engine) under `TZ=America/Chicago`; `lint` 0; `typecheck` clean; `foundation:drift` clean against v1.4.0 (modules removed: billing).

## Phase 2 — the database under the engines (2026-10-29)

### Stored rows against the same 12 files — `npm run engine:eval:db`

The fixture goes in through the real writers (tree writer under advisory locks, the vote path with live V-rules), ranks are recomputed at `NOW`, then what is **stored** is diffed: orderings from `RankSnapshot`, counts from the `ups`/`downs` caches, outcomes from `VoteEvent`, renders from the stored `path`/`depth`.

| Check | Result |
|---|---|
| 12 expected files | 12/12, 19,568 rows, 0 differences |
| Stored `path` = engine `assignPaths`, stored `depth` = segments − 1 | 5,000 / 5,000 |
| `votes:verify` (cache = Vote rows = event replay) | 5,500 nodes, 0 mismatches |
| `BrigadeSignal` rows (D-31) | exactly 1: `P-BRIGADE`, 7 voters, window start T0 + 1 h |
| `commentCount` = comments per post (D-13) | 500 / 500 |
| Load through the writers | 16,457 rows in 78 s (local PG 16; one transaction) |

### Database tests — `npm test` (`tests/integration/forum.test.ts`, 7 tests; suite 238/238 in 40 files)

Append-only triggers refuse UPDATE and DELETE on `VoteEvent` and `EditHistory`; 50 concurrent replies to one parent get 50 distinct ordinals and `commentCount` 51; a parent from another post is `TREE_INVALID`, a removed parent `PARENT_REMOVED`, a deleted parent accepts (D-30); the unique index refuses a second current vote row and the CHECK refuses `value = 2`; V-1..V-4 live with the caches tracking; five gated downvotes in 600 s write one signal and the sixth updates it; the edit boundary at exactly 900 s (D-32) and `NOT_AUTHOR`.

### ADR-001 on the real schema — `npm run adr:measure:db` (task 2.8)

Local PG 16.15, the Prisma `Comment` table (5,000 rows loaded) vs a TEMP closure table from the same rows:

| Query | Materialized path | Closure table |
|---|---|---|
| Whole thread, median / p95 | 1.004 / 1.100 ms | 1.904 / 2.100 ms |
| Permalink subtree, median / p95 | 0.041 / 0.051 ms | 0.067 / 0.080 ms |

Closure / path = 1.90× on the thread fetch; the task's stop (closure better by 2×) did not fire. **CI's Postgres 17 run posts the same table on PR #1** (step after `engine:eval:db`); see `docs/adr-001-tree-storage.md` for the copied numbers. Both thread queries read 296 buffers: at 5,000 rows the planner scans the table rather than the index, so this measures sort and join cost, not index selectivity.

### Schema proof — CI `prisma migrate diff`

The hand-written migration and `prisma/schema` agree (after D-34: the `text_pattern_ops` index could not be round-tripped and was replaced by a `COLLATE "C"` path column; `EXPLAIN` shows the unique btree serving the prefix scan as `path >= p AND path < p+1`).

## What these numbers are not

They are not a benchmark of the forum, a measure of spam resistance, or evidence that Hot or Best are good orderings for a homelab community. The fixtures contain the attacks their author imagined (one brigade, one spam wave, a few self-votes); the constants are reddit's historical ones, untuned. Phase 3 adds the XSS suite and the spam-bot script against a running app; Phase 2 re-measures ADR-001 on CI's Postgres 17 with the Prisma schema.
