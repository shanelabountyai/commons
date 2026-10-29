# NEXT

## ▶ Phase 3 DONE; stopped at the gate (2026-10-29). Shane reviews PR #1 and `docs/phase-4-tasks.md`. No Phase 4 work until go.

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
