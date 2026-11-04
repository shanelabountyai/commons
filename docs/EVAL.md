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

## Phase 3 — hostility (2026-10-29)

### XSS fixture set through the renderer — `npm run xss:check`

59 cases (`fixtures/xss/cases.json`, frozen in MANIFEST; 50 markdown bodies, 9 plain-text fields), each with the tag-anchored live patterns it must not produce (D-41) and the text that must survive: **59/59 inert**, slowest the 200 kB body at 54 ms. The allowed subset renders (X-45), markdown links carry `rel="nofollow ugc noopener"` (X-46), `javascript:`/`data:`/`vbscript:` links in five encodings lose their href, raw HTML is text, code fences show scripts as text, 500 nested quotes and 2,000 nested list markers keep their content (D-42). A planted passthrough in a throwaway copy fails 10 cases. The same 59 run in vitest (`tests/engine/render.test.ts`).

### Limits through the live store — `npm run abuse:spam`, `npm run abuse:normal`

Both replay the Phase 1 scripts through `guardAndRecord` on a throwaway org in the test database (dropped afterwards) and diff against `expected_limits.csv`:

| Script | Attempts | Allowed | Refused | First retryAfter |
|---|---|---|---|---|
| spam-young-comments | 60 | 2 | 58 | 58 s |
| spam-young-posts | 20 | 1 | 19 | 3,540 s |
| spam-young-votes | 100 | 20 | 80 | 50 s |
| normal-u050 posts / comments / votes | 2 / 29 / 55 | 2 / 29 / 55 | 0 / 0 / 0 | — |

Identical to the pure engine's numbers: the store supplies the history, the engine decides, and refusals write no rows (D-45).

### Action door — `npm test` (`tests/integration/actions.test.ts`, 6 tests; suite 307/307 in 42 files)

A young account hits its lower limits with `retryAfter` 58 and no row written; `BANNED_UNTIL` writes nothing and lifts on time; `NOT_MEMBER`; `INPUT_INVALID` for an empty title and a 50,001-char body; `UNKNOWN_NODE`; `GATED_DOWNVOTE` through the door, then `APPLIED` after 24 h and 3 contributions; the sweep drops every row past the longest window. One test per refusal code (brief §3b).

### Dependencies — `npm audit`

`markdown-it 15.0.3` and `isomorphic-dompurify 4.6.0` add no advisories. Nine pre-existing advisories belong to template dependencies, including `next` at critical; flagged for the template (D-46), not changed here.

## Phase 4 — people and moderators (2026-10-29)

### Moderation and uploads — `npm test` (`tests/integration/moderation.test.ts` 6, `uploads.test.ts` 2; suite 316/316 in 44 files)

Report → case opens once per node and counts reporters; remove → restore keeps both `ModerationAction` rows and `UPDATE`/`DELETE` on the table are refused by trigger `commons_append_only`; an illegal transition (`CLEAR` on a removed post, a second `LOCK`, `WARN` on a banned member) is `TRANSITION_INVALID` naming both states; the full table in `rules/moderation.json` is checked by name; a non-moderator member is `NOT_MODERATOR`; a 24 h ban refuses the banned member's post with `BANNED_UNTIL` and the lift time, and lifts; lock refuses `reply` with `THREAD_LOCKED`; the fixture's brigade is one queue item; the same ≥ 40-char body posted twice inside 24 h is accepted and raises one `DuplicateSignal`; reviewing clears both signals from the queue. Uploads: PNG/JPEG/WebP by declared type **and** magic bytes (SVG bytes declared as `image/png` are `INPUT_INVALID`, and `image/svg+xml` is not an allowed type), 2,000,000-byte cap, author-only, bytes outside the database.

### Template invariants over the forum actions — `tests/invariants/inv-01-04-22-actions.test.ts`, 14/14 (all invariant files 81/81)

Ten forum actions (`newPost, reply, vote, edit, report, moderateContent, moderateThread, moderateUser, reviewBrigade, reviewDuplicate`) and the template's own, discovered by glob and run through INV-01 (wrapped), INV-02 (cross-org ≡ not found), INV-03 (secondary rows scoped), INV-04 (no echo before authz) and INV-22 (membership checked, not asserted); the five planted controls still turn each invariant red.

### The pages in a browser — `e2e/commons.spec.ts`, 5/5 in 3.2 min, axe 0 violations light and dark on 10 page loads

The fixture community loaded through the real writers into a fresh org, then: boards → `selfhosting` under Hot / Top all time (P-GH-50 first) / New, `rankedAt` shown → P-CHAIN with `[deleted]` and `[removed]` in place, 11 comments · 2 top-level shown, continue-thread to a permalink with 6 ancestors → reply, a gated downvote answered `GATED_DOWNVOTE`, an edit inside the 900 s window with no mark → **all 48 markdown-class XSS fixture bodies posted through the comment form: 47 stored and inert in Chromium** (no `script img svg iframe object embed form input style math`, no `on*` attribute, no `javascript:`/`data:`/`vbscript:` URL inside any rendered body; no dialog fired) and **X-37 refused `INPUT_INVALID`** → report → queue shows the case and the 7-voter brigade with author history → remove → restore → log `RESTORE` over `REMOVE`, `DELETE` refused → search by title.

### Two more things the capstone found in CI (production build, PG 17)

The first Phase 4 CI run failed on Playwright: (1) the mod log showed `REMOVE` above `RESTORE` because both landed in the same epoch second and the log had no order beyond `createdAt` — fixed with a `seq` column as the total order (D-56); (2) the template's onboarding spec expected the projects empty state on the org home, which Commons redirects to the forum (D-57). Both reproduced locally only against the production build (`npm run e2e:server`), not the dev server.

### A bug the capstone found — fixed behind a failing test

X-37 (a NUL byte inside `<script>`) was inert through `src/render` (`xss:check` never writes to the database) but **crashed the write** with Postgres `invalid byte sequence for encoding "UTF8": 0x00` — a 500 where the design promises a coded refusal. `actions.test.ts` got the red test first; `checkText` now refuses U+0000 (D-53, commit `08b65e6`). The fixture already existed; the renderer check alone had not been enough to find it.

### The demo — `npm run commons:demo` (every number in `docs/DEMO.md`)

Seed 16,457 rows through the writers in 71 s. Hot vs Top vs New on one board at the fixture instant (net 0 at 10 h above net 14 at 27 h under Hot, by the formula). Spam wave from a 1 h-old account: 60 comments → 2 allowed / 58 `RATE_LIMITED` / retryAfter 58 s, 5 posts → 1 / 4, one `DUPLICATE` signal. Brigade: 7 gated downvotes from 2 h-old accounts → counted downs still 0, one `BRIGADE(7)` item; `REVIEW_SIGNAL`, `REMOVE`, `RESTORE` logged; `DELETE` refused, rows still 3.

### Build, lint, drift, audit

`next build` clean (Next 16, all forum routes dynamic); `eslint` 0; `tsc` clean; `foundation:drift` clean against v1.4.0; `engine:lint` OK (purity, single writer, single renderer). `npm audit`: 15 advisories, **0 added by Phase 4** (lockfile unchanged this phase; six new ones published against existing template dependencies since Phase 3) — template-owned, flagged for saas-foundation (D-54).

## Phase 4.1 — the defect patch (2026-10-30)

Fifteen rows from `docs/phase-4.1-tasks.md`, each with its failing test committed before the fix (rule 7). Everything below ran locally against PostgreSQL 16.15 and the production build; CI repeats it on 17.

### The door, closed again — `npm test` (`actions.test.ts` 9, `moderation.test.ts` 10; suite 332/332 in 46 files)

`submitEdit`: a banned author is `BANNED_UNTIL` with the lift epoch, a NUL byte or an empty edit is `INPUT_INVALID`, a stranger is `NOT_MEMBER`, the body is rehashed; `engine:lint` gains the single-door rule (nothing under `src/app` imports `@/forum/edit`, `tree-write` or `votes`, or calls `guardAndRecord`) and was proven red on the old import. `submitReport` admits first. Brigade constants read from `rules/limits.json` (`signals.brigade {min_voters 5, window_seconds 600}`), zero voters and unknown keys refused by name; `P-BRIGADE` still one signal; `abuse:spam` unchanged. `deleteOwn`: `[deleted]` in place, child and both vote rows kept, `commentCount` unchanged, a reply under a deleted comment still allowed, the deleted node refused on a second delete. `authorHistory` counts a report on a comment. `editHistoryFor` returns previous bodies newest first with the window flag and nothing for another org. A banned moderator is `BANNED_UNTIL` before any action; a moderator cannot warn or ban a moderator (an owner can); `GRANT_MOD` / `REVOKE_MOD` are logged with `MEMBER ↔ MODERATOR`; a repeat report is `ALREADY_REPORTED` and the reporter's detail text reaches the queue item.

### Copy and time — `tests/unit/refusals.test.ts` 5, `tests/unit/time.test.ts` 2

`BANNED_UNTIL` → "Your account is banned until 2026-10-30 00:00 UTC. (BANNED_UNTIL)"; `RATE_LIMITED` keeps the action and `retryAfter`; `ago()` gives "just now", "12 min ago", "3 h ago", "7 d ago", "in 5 d" (never "10080 min ago").

### The renderer, amended — `npm run xss:check` 61/61 (D-61)

Two new fixture cases and two new live patterns (`<h1-3`, `<a … target=`), regenerated by the generator with the twelve expected CSVs reproducing byte-for-byte; the renderer was red on 5 cases until the heading-demotion rule and the link policy landed; `render.test.ts` 65/65.

### In a browser — `e2e/commons.spec.ts`, full Playwright 18/18 against the production build in 2.6 min

New since Phase 4: a plain member's thread view shows no hot score; an upvote answers `APPLIED` and the same button then `TOGGLED_OFF`, with the panel still open; an edit lands on `#<comment>`; an upload refusal is visible without a click; a `RATE_LIMITED` reply keeps the typed body and the refusal takes focus; every page has its own title; no horizontal scroll at 320 px on the thread and board pages; the skip link; vote buttons ≥ 24 × 24 px; axe 0 violations at 320 px and after a vote; `<time dateTime>` present. The XSS walk now stores 51 of 52 markdown cases (X-37 refused) across two pages of the thread and scans every page for `script img svg iframe … h1 h2 h3`, `on*`, `target` and bad URL schemes: none.

### Gate

CI green at `df78efb` (https://github.com/shanelabountyai/commons/actions/runs/41139192206) after four runs red on 4.1.6 alone — the upload route handlers had never been committed (D-69); `npm run repo:ignored` now guards it. `engine:lint` OK (with the door rule); `ranking:golden` 44 OK; `engine:eval` 12 files / 19,568 rows / 0 differences; `fixtures:check` OK (18 files, 12 reproduce); `foundation:drift` clean; `tsc` clean; `eslint` 0; invariant harness 14/14 with two new actions (`deleteOwn`, `moderatorFlag`); `npm audit` 15 advisories, 0 added (lockfile unchanged).

## Phase 5 — ranking measured (PRD 5.3, 2026-11-01)

Command for every number below: `python3 -I tools/rank_study.py` (6.8 s; `--json` for the raw report). Frozen fixture: 500 posts, 5,000 comments, 10,607 vote events, six boards; votes reduced by the same oracle as the expected files, at 147 steps of 6 h ending at the fixture instant (2026-11-05T00:00Z). Nothing under `fixtures/` changed; `ranking:golden` 44 OK with GH-08 and GW-09 printed as pending.

### Claim 1 — "Hot may be ordering ≈ New": the fixture supports it

| Gravity | Spearman ρ, median per board (6 boards) | Kendall τ, median | Posts reaching Hot's top 5 that never reached New's |
|---|---|---|---|
| 45,000 s (current) | 0.994 – 0.999 | 0.948 – 0.983 | **0 on every board** |
| 90,000 s | 0.992 – 0.996 | 0.932 – 0.957 | 0 on every board |
| 150,000 s | 0.981 – 0.991 | 0.897 – 0.934 | 0 on every board |

Median hours in the top 5 are the same under Hot and New on 4 of 6 boards and within 3 h on the other two. The low minima (help ρ −0.5 at 45,000 s) are the first steps, when a board has 3–4 posts. **What it means:** on this fixture Hot surfaces nothing New does not, and tripling gravity does not change that — the cause is vote volume (median post net 4), not the constant. **What it cannot say:** how a real homelab board's votes are distributed in time; the fixture's vote timing is generated.

### Claim 2 — "Best on small n is mostly the tiebreak": partly

| Measure | Value |
|---|---|
| Comments whose only vote is the author's fixed +1 | 1,945 of 5,000 (38.9 %); 1,892 of the visible ones |
| Sibling groups (≥ 2 children of one parent) | 878 |
| … every member with n ≤ 2 | 263 (30.0 %) |
| … every member with n ≤ 3 | 442 (50.3 %) |
| … every member's Wilson score equal — Best is purely D-9's `(created desc, id asc)` | 120 (13.7 %) |

(The PO pass quoted 1,941; the SME's 1,945 matches this definition, which counts every comment.) **What it means:** Best decides by tiebreak alone in about one group in seven, and works on two votes or fewer in three in ten.

### M4 — Best without the author's +1 (proposed GW-09)

The first comment changes in **45 of 878** sibling groups (5.1 %); median Kendall τ between the current and the alternative order is **1.000** over the 365 groups of three or more. **What it means:** excluding the author's +1 from Best would change little on this fixture.

### M6 — the downvote gate against first downvotes

195 users ever downvote; 185 first downvotes pass the gate and 10 are gated (7 of them the planted brigade). Account age at first downvote: p10 846 h, p50 5,032 h; **none** is within 1 h of the 24 h threshold. Contributions at first downvote: p10 3, p50 5; **77** are within 1 of the 3-contribution threshold. **What it means:** on this fixture the age half of the gate never binds outside the planted young accounts; the contribution half sits where real-looking behaviour is. **What it cannot say:** anything about aged sockpuppets — the fixture has none besides the planted ones, so it cannot calibrate 5.2's `aged_brigade` thresholds; 5.2 needs its own fixture.

### M7 — pacing (non-flagged users)

Vote gaps: p1 129 s, no gap under 2 s, at most 2 votes by one user in any 60 s (the regular limit is 30). Comment gaps: 223 of 4,815 are **0 s** across 109 users, and the busiest user posts 6 comments in 60 s — exactly the regular limit. **What it means:** the generator places some comments at identical seconds, so the fixture's comment pacing is an artifact, not human pace; it cannot calibrate the comment window. Vote pacing is far below every vote limit.

### Net

The fixture supports claim 1, partly supports claim 2, and on its own evidence would change little if either proposed case were adopted (gravity does not separate Hot from New; GW-09 moves 5 % of top comments). It cannot calibrate the age gate, the aged-brigade signal or the comment window. Decisions are the owner's (D-63).

## Phase 5 — vote signals as data (PRD 5.2, 2026-11-01)

Commands: `npm run engine:eval`, `npm run engine:eval:db`, `npm test`, `python3 -I tools/golden_answers.py`.

- **Fixture first:** `fixtures/signals/scenarios.json` — 9 scenarios, 74 vote events (seed 20261101) — and `expected_signals.csv` (6 rows) from the stdlib oracle `tools/signallib.py`, hashed into the manifest; the 12 community expected files are byte-identical. Golden GS-01..GS-08: 52 cases OK.
- **Pure detector** (`src/votes/signals.ts`): `engine:eval` 13 files / 19,574 rows / 0 differences; engine tests 120/120.
- **Through the database:** the 9 scenarios replayed through `castVote` reproduce all 6 expected rows; the community's 10,607 votes raise exactly one signal, the planted `BRIGADE` on P-BRIGADE (7), and **no** `RING` or `AGED_BRIGADE` — the false-positive check. Moderation tests: a 6-account ring opens one `RING` item with the post's ups at 7 (author + 6, unchanged by the signal) and a logged review naming RING; 5 accounts four days old downvoting open one `AGED_BRIGADE` with downs at 5, while 5 accounts 90 days old raise nothing.
- **Cost, measured:** the bulk load of the community through the writers took 71 s before 5.2 and 132–138 s after (two runs), because each applied upvote now counts the voter's contributions for the young check. The page path pays one or two extra indexed count queries per vote.
- **What it is not:** thresholds were set by scenarios the author wrote; a ring of accounts older than 24 h with 5 contributions, or a brigade spread over 11 minutes, raises nothing. Every vote still counts — a signal asks a human to look.

## Phase 5 — vote control (PRD 5.1, 2026-11-02)

Commands: `npm test`, `npx playwright test` (production build, as CI).

- **The viewer's votes** (`myVotes`, one org-scoped read per page): `tests/integration/view.test.ts` — 1 / −1 / 0 per node, 0 after a toggle (V-3), the author's fixed +1 reads 1 (D-12), nothing from another org (INV-03).
- **In the browser** (`e2e/commons.spec.ts`, 5.1 test): on a comment, one click on ▲ with no panel opened → `APPLIED`, `aria-pressed="true"` and the visible text "upvoted"; again → `TOGGLED_OFF`, unpressed; a minutes-old member's ▼ is named "… recorded, not counted until your account is 24 h old with 3 contributions" and answers `GATED_DOWNVOTE`, unpressed; both buttons ≥ 24 × 24 px; the member's own comment shows "+1 (yours, fixed)" and no vote buttons; on the board page a post's ▲ answers `APPLIED` and shows pressed; the permalink page at 320 px has no horizontal scroll and shows the control. axe 0 violations in light and dark on the thread and board after votes and on the permalink at 320 px.
- **Gate:** vitest 347/347 (48 files); full Playwright 19/19 in 3.8 min; harness 14/14; `engine:eval` unchanged (13 files, 0 differences).
- **What it is not:** no optimistic update — the state shown is the server's after the action returns; the gate note is computed per page view, so an account that crosses 24 h mid-page sees it on the next load.

## Phase 5 — mod queue triage, Part A (PRD 5.4 A, 2026-11-02)

Commands: `npm test`, `npx playwright test` (production build, as CI).

- **Reporter records from the log** (`reporterRecords`): `tests/integration/moderation.test.ts` — a reporter whose two earlier reports ended one `REMOVED` and one `CLEARED` reads `1 / 1`; a report removed then restored counts for neither; the handle and `joinedAt` ride along.
- **Same-second duplicate** (found by run 3 of the sweep): two copies of one ≥ 40-char body at the same epoch second raised no `DUPLICATE` signal under the strict `lt`; red test M-P10/M-P11, then `lte` (D-80).
- **In the browser** (`e2e/commons.spec.ts`, 5.4 A test): with CASE (2), BRIGADE (1) and DUPLICATE (1) present, each kind filter shows exactly its items and the count beside the link; clearing one case returns to the same `?kind=CASE` page; the remaining case's reporter line reads `… 0 removed / 1 cleared before): harassment`; the excerpt is ≤ 240 chars (+ellipsis) with the full body closed; Warn and Lock from the queue land on the same filtered page, the row reads `(WARNED;` then `thread locked`, and the log's first two rows are LOCK then WARN with `seq` strictly descending and the post title linked; 50 synthetic rows push the run's first REMOVE onto log page 2 ("Log page 2 of 2"); the filtered queue at 320 px has no horizontal scroll. axe 0 violations light and dark on the filtered queue at 1280 and at 320 px.
- **Gate:** vitest 349/349 (48 files); harness 14/14; full Playwright 20/20 in 57.5 s of tests (plus the production build); `engine:eval` 13 files / 19,574 rows / 0 differences; `fixtures:check` OK.
- **What it is not:** the reporter record is a count of how a moderator ruled on that reporter's past reports, not a reputation score, and it hides nothing (D-31); the filters are reads over the open queue in memory (fine at the fixture's scale, revisit past a few thousand open items); nothing in Part A changes what a lock refuses or raises a swarm signal — that is Part B.

## Phase 5 — mod queue triage, Part B (PRD 5.4 B, 2026-11-02)

Commands: `npm run engine:eval`, `npm run engine:eval:db`, `npm test`, `npm run fixtures:check`.

- **Report swarm, oracle first** (`tools/modlib.py` → `fixtures/moderation/`): 8 scenarios, 44 reports, 2 signals expected — `S-SWARM` (4 reporters 1–3 days old, 8 reports in 6 h → one signal, 4 reporters) and `S-SWARM-GROWS` (the 4th report opens it, a 5th 20 h later updates the count to 5, no second row). No signal from: 6 reporters 60–200 days old in 1 h; 3 fresh reporters; one fresh reporter on 8 nodes; 4 fresh reporters with the 4th exactly 86,400 s after the first; 3 fresh and a 4th exactly 7 days old; 3 fresh plus 3 old.
- **Three derivations agree:** the oracle, the pure detector (`tests/engine/report-swarm.test.ts`, 10 tests; `engine:eval` 14 files / 19,576 rows / 0 differences) and the stored rows after replaying every scenario through `submitReport` (`engine:eval:db`: 2/2 rows, 3 of S-ONE-MANY's 8 reports refused by the report window, the signal count unchanged).
- **Live** (`tests/integration/moderation.test.ts`): the 4th fresh reporter opens one `REPORT_SWARM` naming the member and all reporters, the 5th updates it, the 5 reports and their cases stand, review is logged against the member; 4 reporters older than 7 days and one fresh reporter on 4 nodes raise nothing.
- **A lock locks** (`tests/integration/actions.test.ts`, red before the door changed): reply, vote and edit on a locked thread — post or comment — are `THREAD_LOCKED`, no limit hit, vote event or edit history is written, and unlock reverses; with `lock_refuses: ["reply"]` a vote goes through and a reply does not; a caller passing no moderation rules is refused on all three.
- **Gate:** vitest 363/363 (49 files; +14 over Part A: 10 detector, 2 swarm live, 2 lock), harness 14/14 with `reviewSwarm` discovered; full Playwright 20/20 on the production build (1.0 min of tests), axe 0 on 32 measurements; `engine:eval` 14 files / 19,576 rows / 0 differences; `engine:eval:db` 2/2 swarm rows through `submitReport` over 8 scenarios (3 reports refused by the report window); `fixtures:check` OK (22 files in the manifest, 14 expected files reproduce); `engine:lint`, `foundation:drift`, `migrate diff` (empty), eslint, tsc clean.
- **What it is not:** the acceptance line "the community's reports raise no `REPORT_SWARM`" is vacuous — the frozen community fixture has no reports, so the false-positive evidence is the three organic scenarios the author wrote, nothing measured on realistic report traffic. Four thresholds (4 / 7 days / 24 h) are D-79's proposal, untuned. The swarm row names reporters; it hides nothing and ranks nobody (D-31).

## Phase 5 — gate (2026-11-02)

Commands: `npm run engine:lint`, `npm run fixtures:check`, `npm run engine:eval`, `npm run foundation:drift`, `npm test`, `npx tsc --noEmit`; browser numbers from CI run 41529479036 on PR #6 (`4839634`). Head checked: `f311a51`, which contains `phase-5`, PR #5 and PR #6.

- **Signals, fixture first:** `RING` and `AGED_BRIGADE` (`tools/signallib.py`, 9 scenarios / 74 events / 6 rows) and `REPORT_SWARM` (`tools/modlib.py`, 8 scenarios / 44 reports / 2 rows); `engine:eval` 14 files / 19,576 rows / 0 differences, `fixtures:check` OK (22 files in the manifest, 14 expected files reproduce).
- **Suite:** vitest 363/363 in 49 files, harness 14/14 (`reviewSwarm`, `deleteOwn`, `moderatorFlag` discovered); `engine:lint` OK over the three rules files; `foundation:drift` and tsc clean.
- **Browser (CI):** full Playwright 20/20 on the production build, axe 0 on 32 measurements, light and dark, 320 px included.
- **Not re-run locally:** Playwright and `engine:eval:db`; CI owns the sweep and it is green on the code head. The docs-only commit on top (`f311a51`) changes no tested path.
- **What the gate does not say:** `phase-5` has not been re-tested with 5.4 merged in, because merging is Shane's; the three Phase 5 caveats stand (D-82: `min_contribution_chars`, the vacuous community-report check, GH-08 / GW-09 pending).

## Phase 6 — readability + tokens, Part A (PRD 6.1 A, 2026-11-02)

Commands: `npm run test:e2e` (production build), `npm test`, `npm run xss:check`, `npm run engine:eval`, `npm run fixtures:check`, `npm run engine:lint`, `npm run foundation:drift`.

- **Red first:** the 6.1 A spec (`e2e/commons.spec.ts`) failed on its first new assertion against the pre-change build (`h1 .badge` "Pinned" not found, after the pin action itself succeeded), then passed after the change.
- **Tokens:** the design review §2 block verbatim in `commons.css` `:root`; `.meta` / `.removed` moved from `opacity` to `--ink-muted`, `[role='alert']` to `--danger`, `[role='status']` to `--ok`, every `1px solid CanvasText` border and the thread rail to `--rule`; the two CSS emoji markers deleted. `--warn` is a border colour only: orange 70 % over black on white is about 3.9:1, under 4.5:1, so a "Locked" badge keeps `CanvasText` text and a 2 px warn border.
- **Board page:** `boardPosts` ranks every visible post as before and slices 25 (`BOARD_PAGE_SIZE`, a page constant) after the pinned-first order; sbc has 101 visible posts → 5 pages; P-GW (135th under Hot) now sits on page 6 of sbc's Hot, which moved the 5.1 spec's board-vote step onto a page walk. Rows are a 2-column grid (3.5 rem vote cell, title + `Pinned` / `Locked` badges, `by · ago · N comments` with `<time datetime>`).
- **Wayfinding:** breadcrumb `<nav aria-label="Breadcrumb"><ol>` on board, thread and permalink (board named on the permalink, current page as text); the scope sentence once per page in the org layout's `<footer>`; "Settings: delete org" in that footer for the owner, out of the forum nav; empty states name no CLI.
- **Gate:** full Playwright 21/21 on the production build (1.2 min of tests), axe 0 on 44 measurements light and dark, Boards and board page 2 at 320 / 768 / 1280 px included, no horizontal scroll at 320; vitest 363/363 (49 files); `xss:check` 61/61 unchanged; `engine:eval` 14 files / 19,576 rows / 0 differences; `fixtures:check` OK; `engine:lint`, `foundation:drift`, eslint, tsc clean. No rules file, render rule or expected file changed.
- **What it is not:** axe's 0 is the automated subset; the role colours were checked by arithmetic against Canvas white and black, not against a user's forced-colours or high-contrast theme. The board page's `total` is the visible count under the sort window, not a count query. The thread (type hierarchy, per-comment headings, subtree collapse, shared `Tree`, M2 / M5 link text) is Part B.

## Phase 6 — readability + tokens, Part B (PRD 6.1 B, 2026-11-03)

Commands: `npm run test:e2e` (production build), `npm test`, `npm run xss:check`, `npm run engine:eval`, `npm run fixtures:check`.

- **Red first:** the 6.1 B spec failed on its first assertion against the pre-change build: `ol.thread li.c > article > h3` expected 8 on P-CHAIN, received 0.
- **Thread:** one `h3` per rendered comment (the article `aria-label` dropped); removed and deleted comments headed `Removed comment (by moderator)` / `Deleted comment` with a badge; every subtree in `<details open>` whose summary counts the rows rendered below it (C-CHAIN-0's reads the count the page shows, not the tree module's); one `clamp()` indent rule (at 320 px a level costs ≤ 16 px, asserted); post `h1` at 24 px (`--fs-xl`, asserted); relative ages and an `Edited` badge; the comment pager is the shared `Pager`.
- **Links (M5):** 8 permalinks on P-CHAIN, 8 distinct accessible names; continue-thread reads `Continue the thread under <handle>'s comment`, no arrow glyph.
- **Permalink (M1):** the shared `Tree`, so nested `<ol>`s and no inline `margin-left`; an `h2` above the tree after axe's `heading-order` flagged `h1` → `h3` in the first sweep (fixed, D-85).
- **Gate:** full Playwright 22/22 on the production build (1.1 min of tests), axe 0 on 62 measurements light and dark, the thread, the deep thread and the permalink at 320 / 768 / 1280 px included, no horizontal scroll at any of them; vitest 363/363; `xss:check` 61/61 unchanged; `engine:eval` 14 files / 19,576 rows / 0 differences; `fixtures:check` OK; `engine:lint`, `foundation:drift`, eslint, tsc clean.
- **What it is not:** distinct permalink names rest on the UTC minute; two comments by one member in the same minute would still share a name. Collapse state is the browser's and is not remembered. axe is the automated subset; no screen-reader session was run.

## Phase 6 — board descriptions (PRD 6.3, 2026-11-03)

Commands: `npm test`, `npm run test:e2e` (production build), `npm run xss:check`, `npm run engine:eval`, `npm run fixtures:check`, `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code` (with `SHADOW_DATABASE_URL`).

- **Red first:** `tests/integration/boards.test.ts` 8 of 8 red (`describeBoard is not a function`); the 6.3 e2e red on the pre-change build (no `Self-hosting` link: titles were slugs).
- **Rules held:** owner and admin set a description; a member and a moderator-flagged member are refused `Missing permission: org.update`; 301 chars, a newline and a NUL refused `INPUT_INVALID`; 300 chars allowed; `'   '` clears to `''`; one `forum.board.describe` audit row with `{ from, to }`. The loader writes six descriptions and the six `boards.csv` titles; a second run inserts nothing.
- **Browser:** a stored `<img src=x onerror=alert(1)>` description renders as text (0 `img`, 0 `[onerror]`); a member sees no edit control; the owner's edit shows on both pages.
- **Gate:** vitest 382/382 (51 files; +8), harness with `describeBoard` discovered (0 findings); full Playwright 24/24 on the production build (2.8 min), axe 0 on Boards and a board page at 320 / 768 / 1280 px, light and dark; `xss:check` 61/61 (`src/render` untouched); `engine:eval` 15 files / 19,607 rows / 0 differences; `fixtures:check` OK, `fixtures/` unchanged; `engine:lint`, `foundation:drift`, `migrate diff` (empty), eslint, tsc clean.
- **What it is not:** a description is plain text, so a link in one is not a link. Orgs loaded before the migration show none until an owner writes one or the dev DB is reloaded.

## Phase 6 — §C measurements (PRD 6.4, 2026-11-03)

Commands: `python3 -I tools/reference_rank.py` (the oracle), `npm run engine:eval`, `npm run engine:eval:db`, `npm run abuse:spam`, `npm run abuse:normal`, `npm run ranking:golden`, `npm test`. Bind test (D-92), fixed before any number: today's rules allow the scripted attack, the candidate refuses it, and it refuses 0 community actions; a vacuous normal side does not count. Depth is T-2's (top level 0).

| Hypothesis | Attack: today → with the rule | Community (frozen fixture) | Verdict |
|---|---|---|---|
| Reply-chain flood, `profile+post` window 10 / 3600 s, young 3 | `spam-flood-thread` (u050, one post, every 10 s for an hour): 360 allowed → **10 allowed, 350 refused**, first retryAfter 3500 s | `normal-community-thread`: 5,000 comments, **0 refused**; most by one author on one post: 3 in any 60 s or hour, 5 in a day, 15 in total; young members peak at 2 an hour | **Binds** (D-93) |
| `max_depth_written` 32 | `spam-deep-chain` (60-deep self-reply, one per 400 s): 60 allowed → **33 allowed, 27 refused** `INPUT_INVALID`, no retryAfter | `normal-community-depth`: 5,000 comments, **0 refused**; deepest 11, p99 6, 24 past the render cut of 6 | **Binds** (D-93, D-94) |
| Link-host extraction | 20 posts, 20 hosts, different wording: **0** duplicate signals | No bodies in the fixture (`body_hash` only) | **Not measurable**: no normal side |
| Repost title/body hash | Same post every 25 h for 7 posts: **0** signals at `duplicate.window_seconds` 86,400; **6** at 604,800 | 0 repeated (author, `title_hash`) pairs, 0 repeated `body_hash`: unique by construction | **Not measurable**: the normal side is vacuous |
| Pin cap | None scripted | 0 pins | **Not measurable**: no member path; a moderator's pins are in the public mod log |

- **Oracle first:** four rows added to `fixtures/expected_limits.csv`, the seven existing rows byte-identical (`git diff`: additions only); golden 64 OK with GL-23..GL-26.
- **Red first:** the rules loader tests 5 of 7 red and the limits suite red on the missing `replayComments`; `actions.test.ts` 2 red (the 11th reply and the depth-33 reply both resolved).
- **Where it binds:** the PRD's draft read the depth from 1 (max 12, p99 7, 53 past the cut). On T-2 the chain allows 33 levels; kept by Shane because `max_depth_rendered` 6 counts the same way (D-94).
- **Gate (local, Mac):** vitest 390/390 (51 files; +8); `engine:eval` 15 files / 19,611 rows / 0 differences; `engine:eval:db` OK (`expected_limits` 11/11, 40 s on a quiet machine); `abuse:spam` and `abuse:normal` OK (6 and 5 scripts); golden 64 OK; `fixtures:check` OK; `xss:check` 61/61; `engine:lint` (6 windows), `foundation:drift`, `migrate diff` (no difference, no migration), eslint and tsc clean. Playwright 24/24 on the production build (1.1 min). **Found by CI:** the XSS walk posts 48 comments on one thread, and the new window refused the 11th (`Slow down … 3599 s`). The spec already lifted the profile window by deleting `LimitHit` rows; it now also ages its own comments out of the hour. That is a setup change; no expected value changed.
- **What it is not:** two rules, each pinned by one attack the author scripted and one community replay. Three of five hypotheses stay open until the community fixture has bodies, organic reposts and pins (the carried regeneration decision, D-75, D-81). Nothing here measures a late edit (B7).

## Phase 6 — gate (2026-11-04)

Commands: `npm run engine:lint`, `npm run fixtures:check`, `npm run ranking:golden`, `npm run engine:eval`, `npm run xss:check`, `npm run foundation:drift`, `npm run repo:ignored`, `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run test:e2e -- -g "Phase 6 gate"` (production build). Head checked: `40edfb7` on `phase-6.4`, which stacks 6.1 A → 6.1 B → 6.2 → 6.3 → 6.4 (PRs #7–#11) on `phase-5.4b`.

| Gate clause | Evidence | Result |
|---|---|---|
| Every page axe 0 at 320 / 768 / 1280, light and dark | Boards, a board (page 2 and with descriptions), the thread, the deep thread, the permalink, a thread with attachments (6.1 A, 6.1 B, 6.2, 6.3 specs); **search, a profile and the mod queue added at this gate** (18 measurements) | **Passes after one fix**: the new test was red on the profile at 320 px light, `scrollable-region-focusable` (serious) on the member's moderation-log table; both forum tables now carry `tabIndex={0}` and a name (D-95) |
| Each readability item closed by a browser spec that failed first | 6.1 A (`h1 .badge` not found), 6.1 B (0 of 8 `h3`s), 6.3 (no `Self-hosting` link) | Passes |
| Upload limits proven by oracle-written `expected_limits.csv` rows and `engine:eval` | `spam-young-uploads` 2 / 28 / 3580 (D-88), `uploads/cases.json` 30/30, GL-15..GL-22 | Passes |
| `xss:check` unchanged | 61/61; `git diff phase-5.4b...HEAD -- src/render src/tree` empty | Passes |
| `npm test`, harness, e2e green in CI | vitest 390/390 in 51 files locally; CI run 41743879806 green on the 6.4 code head (`57a27b3`) | Passes on `57a27b3`; **the two gate commits need their own CI run** (the push opens it) |

- **Engines and fixtures:** `engine:eval` 15 files / 19,611 rows / 0 differences; `fixtures:check` OK; golden 64 OK (GH-08 / GW-09 pending, not asserted); Phase 6 changed `fixtures/` by additions only (the upload cases, five `expected_limits.csv` rows, the manifest); `engine:lint` (6 windows), `foundation:drift`, `repo:ignored`, tsc and eslint clean.
- **Not re-run locally:** the full Playwright sweep and `engine:eval:db`, `abuse:spam` / `abuse:normal` (all run at 6.4 on this code, D-94); CI owns the sweep. The only code change since is two table attributes.
- **A gap in the record, not the code:** 6.2 has no section of its own in this file; its numbers are in D-88 and the 6.2 entry of `NEXT.md`.
- **What the gate does not say:** none of PRs #5–#11 is merged, so no merged `phase-5` or `main` has been tested with Phase 6 in it. The members page (template-owned) and the sign-in pages were not measured here. axe's 0 is the automated subset; no screen-reader session was run. The carried caveats stand: `min_contribution_chars` (D-75), the vacuous community-report check (D-81), and the three 6.4 hypotheses that are not measurable without a regenerated community fixture.

## What these numbers are not

They are not a benchmark of the forum, a measure of spam resistance beyond the 59 vectors and 3 scripts the author wrote, or evidence that Hot or Best are good orderings for a homelab community. The fixtures contain the attacks their author imagined (one brigade, one spam wave, a few self-votes); the constants are reddit's historical ones, untuned. Phase 4's browser run is one owner in one Chromium walking the pages the author wrote; axe's 0 is the automated subset of WCAG, not a usability review. Nothing here was measured on a deployed instance, because there is none.
