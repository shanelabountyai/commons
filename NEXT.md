# NEXT

## ▶ Phase 4.1 DONE; stopped at the gate (2026-10-30). Shane reviews PR #3 and decides whether to merge; then Phase 5 PRDs, one at a time.

**Phase 4.1 session (2026-10-30, cloud, Shane's "go").** 15 defect rows from the review gate, each fixed behind a red test, one concern per commit on `phase-4.1` (21 commits incl. the plan). Decisions D-65..D-68.
- **Gate output:** `npm test` 332/332 (46 files); harness 14/14 with `deleteOwn` and `moderatorFlag`; `xss:check` 61/61 (D-61 cases added, red first); `engine:eval` 0 differences; `fixtures:check` OK (manifest regenerated, 12 expected CSVs byte-identical); `engine:lint` OK with the new single-door rule (proven red on the old edit import); drift clean; tsc clean; eslint 0; full Playwright 18/18 against the production build in 2.6 min, axe 0 light+dark incl. 320 px and after an action; audit 15 advisories, 0 added. Every number with its command: `docs/EVAL.md` §Phase 4.1.
- **Found while patching:** the two D-61 fixture cases pushed the capstone's thread past 50 top-level comments, so the XSS walk now checks storage and scans every page; the dev server's first compile can outlast a 5 min test (seen once; CI uses the production build).
- **Sandbox:** everything ran locally; Postgres had to be restarted (`service postgresql start`) after the overnight idle.

| CI run | Head | Result |
|---|---|---|
| Phase 4.1 head | (PR #3 checks) | pending at the time of writing; the session updates this row when the run finishes |
| Phase 4 head | 63dad8a | **success** https://github.com/shanelabountyai/commons/actions/runs/40967135925 (merged as 5f0ba21) |

**Decisions for Shane:** merge PR #3 or not; confirm or reverse D-65..D-68. Then the Phase 5 PRDs (`docs/phase-5-tasks.md`, D-59), presented one at a time before any build.

**Upstream for saas-foundation (new this phase):** D-67 (ActionForm loses typed input and focus on refusal).

---

## Review gate done; Phase 4.1 planned (2026-10-30). (superseded by the block above)

---

## Phase 4 DONE — the build is closed; stopped at the gate (2026-10-29). (superseded by the block above; PR #1 merged 2026-10-30)

**Phase 4 build session (2026-10-29 ~5–6 PM CT, Fable, cloud, Shane's "go now").**
- Built per `docs/phase-4-tasks.md`, one concern per commit on `phase-1`: `rules/moderation.json` + schema + append-only trigger (4.1) → report / act / queue / state machines (4.2) → duplicate signal (4.5) → pages, mod queue, profile, search, uploads (4.3, 4.4, 4.6, 4.7) → browser capstone with axe (4.8) → `commons:demo` + `docs/DEMO.md` (4.8) → EVAL §4, WRITEUP, CLOSEOUT (4.9). Defaults D-48..D-54, gate D-55.
- **Gate output:** `npm test` 316/316 (44 files); harness 14/14 (10 forum actions under INV-01..04/22); `next build` clean; lint 0; typecheck clean; drift clean; `engine:lint` OK; `engine:eval` 0 differences; `xss:check` 59/59; `fixtures:check` OK; e2e capstone 5/5 in 3.2 min, axe 0 violations light+dark on 10 page loads; demo numbers in `docs/DEMO.md`. Every number with its command: `docs/EVAL.md` §Phase 4.
- **Found while building, all recorded:** the moderator role has to be a Profile flag because `Role` is template-owned (D-48); the append-only trigger also refuses deleting an org that holds log rows (D-49); XSS fixture X-37 (a NUL byte) was inert on the page but a Postgres 500 on write — failing test first, then refused at the door (D-53); `npm audit` 15 advisories, 0 from Phase 4 (D-54).
- **Sandbox:** everything ran locally (PG 16.15, Chromium from /opt/pw-browsers) except `migrate diff` and `check-modules` (CI-only, as before). Three demo orgs (`demo-2026102922*`) remain in the local `commons` database; they cannot be deleted (D-49) and don't matter.

| CI run | Head | Result |
|---|---|---|
| Phase 4 head | 63dad8a | **success** https://github.com/shanelabountyai/commons/actions/runs/40967135925 (full Playwright 14/14 incl. the capstone, migrate diff, eval:db, ADR, abuse suites, vitest, all green on PG 17). First Phase 4 run f3afb1b **failed** on Playwright (run 40965329908) → D-56 log order, D-57 onboarding spec |
| Phase 3 head | 9bbee84 | **success** https://github.com/shanelabountyai/commons/actions/runs/40954954426 |
| Phase 2 head | 3161dfe | success https://github.com/shanelabountyai/commons/actions/runs/40946970972 |
| Phase 1 head | c61c198 | success https://github.com/shanelabountyai/commons/actions/runs/40930385079 |

**Decisions for Shane:** confirm or reverse D-48..D-54 (and D-41..D-46 if not yet). Deploy stays a separate decision: not planned; D-51 names the one seam (two file functions in `src/forum/uploads.ts`).

**By hand (Shane):** `docs/CLOSEOUT.md` § By hand — review/merge PR #1, reuse scan on the Mac, the two upstream items for saas-foundation (security release; a `Role` extension point), build-log card #16, brief + LinkedIn.

---

## Phase 3 DONE; stopped at the gate (2026-10-29). (superseded by the block above)

**Phase 3 build session (2026-10-29 ~4 PM CT, Fable, cloud, Shane's "run it now").**
- Built per `docs/phase-3-tasks.md` (uploads deferred, D-40), one concern per commit on `phase-1`: XSS fixture set first (3.1) → the two sanitizer packages at pinned versions (D-38) and `src/render` as the single sanitizer module with `xss:check` (3.2/3.3) → `LimitHit` table (3.4) → limits store, action door, live gates (3.4/3.5/3.8) → abuse suites and per-code tests (3.7/3.8) → CI (3.9). Defaults D-41..D-46, gate D-47; `docs/phase-4-tasks.md` written for review.
- **Gate output:** `xss:check` 59/59 inert; `abuse:spam` 2/1/20 allowed (retryAfter 58/3540/50) and `abuse:normal` 0 refused through the live store, equal to `expected_limits.csv`; `npm test` 307/307 (42 files); lint 0; typecheck clean; `foundation:drift` clean; `engine:lint` OK with the single-writer and single-renderer rules. Every number with its command: `docs/EVAL.md` §Phase 3.
- **Two findings while building, both recorded:** the fixture's first "live" patterns flagged entity-encoded (inert) text, so they were anchored on real tags before the renderer was judged (D-41); markdown-it silently drops content past its nesting limit, so runs of more than 8 quote/list markers are flattened first (D-42).
- **Audit:** the new packages add no advisories; nine pre-existing ones are template dependencies, `next` at **critical** (D-46). **For saas-foundation:** a `security:` release bumping `next` (and `prisma`, `zod`) is due under the template's own 7-day rule; clones take it after.
- **Sandbox:** everything ran locally except `migrate diff` and `check-modules` (CI-only, as before).

| CI run | Head | Result |
|---|---|---|
| Phase 3 head | 9bbee84 | **success** https://github.com/shanelabountyai/commons/actions/runs/40954954426 (xss:check, eval:db, ADR, abuse suites, vitest, e2e all green on PG 17) |
| Phase 2 head | 3161dfe | success https://github.com/shanelabountyai/commons/actions/runs/40946970972 |
| Phase 1 head | c61c198 | success https://github.com/shanelabountyai/commons/actions/runs/40930385079 |

**Decisions needed from Shane before Phase 4** (`docs/phase-4-tasks.md`): the `moderator` role shape, whether Handhold's report reasons are copied or re-chosen for homelab, and deploy yes/no. Also: confirm or reverse D-41..D-46.

**By hand (Shane):** review and merge PR #1 when ready (now Phases 1–3); the template's `next` security release.

---




**Kickoff session (2026-10-29, cloud, Shane present).**
- Owner decisions: public repo, homelab theme, Commons runs alone (D-1..D-3).
- Kit: PRD v1.1 (homelab, Footnote replaces "Askboard" in P1-4, phasing amended per D-6), CLAUDE.md, KICKOFF.md, decisions D-4..D-18 + O-1..O-3, domain brief, ADR-001 (proposed), overlap check, Phase 1 tasks, `rules/ranking.json`, `rules/limits.json`, `tools/rankinglib.py` + `tools/golden_answers.py`.
- Gate output: `python3 -I tools/golden_answers.py` → `18 cases OK`. Two values hand-checked: hot(50, 0, T0) = 14650.6766811, wilson(70, 100) = 0.60415.
- Template: v1.4.0 is the latest tag (D-4). Port 7500 verified free and added to the `~/.claude/CLAUDE.md` port table on the Mac 2026-10-29 (D-5).
- Not done here: no template clone, no `npm ci`, no app code. `main` doesn't exist on origin yet; the Phase 1 session pushes the untouched template v1.4.0 as `main` and builds on `phase-1`.

**Mac session (2026-10-29):** port row added; reuse scan run (D-19): Handhold is a moderation-queue donor the overlap doc had missed; flat comments and a regex sanitizer there are not donors. KICKOFF step 2 now names the sibling clone folder `~/Projects/commons-app`.

**By hand (Shane):** see KICKOFF.md § Still to do by hand.
