# NEXT

## ▶ Phase 1 DONE; stopped at the gate (2026-10-29). Shane reviews PR #1 and `docs/phase-2-tasks.md`. No Phase 2 work until go.

**Phase 1 build session (2026-10-29, Fable, cloud; Shane approved D-21..D-25 and said go).**
- Built in TDD order, one concern per commit on `phase-1`: 1.2 fixtures + oracles → 1.1 scripts + CI gate → 1.3 ports → 1.4 rules loader → 1.5 ranking → 1.6 tree + ADR-001 → 1.7/1.8 votes + limits → 1.9 `engine:eval` → 1.10 `docs/EVAL.md` → 1.11 CI proof. Decisions D-26 (materialized path, measured) and D-27 (gate record); lineage table filled; `docs/phase-2-tasks.md` written for review.
- **Gate output:** `engine:eval` 12 files, 19,568 rows, 0 differences; `ranking:golden` 44 OK; `engine:lint` OK; `fixtures:check` OK; `npm test` 231/231 (39 files) under `TZ=America/Chicago`; lint 0; typecheck clean; `foundation:drift` clean against v1.4.0 (modules removed: billing). Every number with its command: `docs/EVAL.md`.
- **Before Phase 2 check:** gravity 45000 → 90000 in a copy of `rules/ranking.json`: `expected_post_order_hot.csv` 0/497 and named first; the other 11 files unchanged; no code change.
- **ADR-001:** materialized path, by measurement on PG 16.15 (thread 0.808 vs 1.341 ms median; permalink 0.036 vs 0.178 ms; 232 vs 672 KiB). Re-measure on CI's PG 17 in Phase 2 (task 2.8).
- **Sandbox:** everything ran locally except `foundation:check-modules` (no rsync) and `prisma migrate deploy` (engine download blocked; `psql -f` instead). Postgres had to be restarted between turns (`service postgresql start`).

| CI run | Head | Result |
|---|---|---|
| Red proof, `gate-proof-red` (one swapped expected row), PR #2 | 4f35a34 | **failure at `npm run engine:eval`** https://github.com/shanelabountyai/commons/actions/runs/40930587231 |
| Green, `phase-1` 1.9 head | c61c198 | **success** https://github.com/shanelabountyai/commons/actions/runs/40930385079 |
| Green, `phase-1` scaffold | cc87280 | success https://github.com/shanelabountyai/commons/actions/runs/40927088953 |

**Decisions needed from Shane before Phase 2:** review `docs/phase-2-tasks.md`; O-2 (replies under a removed node), O-3 (brigade signal data shape), and `Vote` as one current row per voter/node vs derived from `VoteEvent`. Confirm or reverse D-26.

**By hand (Shane):** push the template tag from a Mac clone that has both remotes (`git push origin v1.4.0`) so CI stops naming it by SHA; merge saas-foundation PR #9 (CLONES row); PR #2 is closed; **delete the `gate-proof-red` branch** (the proxy refuses branch deletes, 403); PR #1 stays unmerged until reviewed; build-log card #16 → in progress with the repo and PRD links.

---


**Kickoff session (2026-10-29, cloud, Shane present).**
- Owner decisions: public repo, homelab theme, Commons runs alone (D-1..D-3).
- Kit: PRD v1.1 (homelab, Footnote replaces "Askboard" in P1-4, phasing amended per D-6), CLAUDE.md, KICKOFF.md, decisions D-4..D-18 + O-1..O-3, domain brief, ADR-001 (proposed), overlap check, Phase 1 tasks, `rules/ranking.json`, `rules/limits.json`, `tools/rankinglib.py` + `tools/golden_answers.py`.
- Gate output: `python3 -I tools/golden_answers.py` → `18 cases OK`. Two values hand-checked: hot(50, 0, T0) = 14650.6766811, wilson(70, 100) = 0.60415.
- Template: v1.4.0 is the latest tag (D-4). Port 7500 verified free and added to the `~/.claude/CLAUDE.md` port table on the Mac 2026-10-29 (D-5).
- Not done here: no template clone, no `npm ci`, no app code. `main` doesn't exist on origin yet; the Phase 1 session pushes the untouched template v1.4.0 as `main` and builds on `phase-1`.

**Mac session (2026-10-29):** port row added; reuse scan run (D-19): Handhold is a moderation-queue donor the overlap doc had missed; flat comments and a regex sanitizer there are not donors. KICKOFF step 2 now names the sibling clone folder `~/Projects/commons-app`.

**By hand (Shane):** see KICKOFF.md § Still to do by hand.
