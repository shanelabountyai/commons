# NEXT

## ▶ Phase 2 DONE; stopped at the gate (2026-10-29). Shane reviews PR #1 and `docs/phase-3-tasks.md`. No Phase 3 work until go.

**Phase 2 build session (2026-10-29 2:45 PM CT, Fable, cloud, unattended on Shane's scheduled go).**
- Built per `docs/phase-2-tasks.md`, one concern per commit on `phase-1`: schema + migration (2.1/2.2) → tree writer (2.3) → vote path + brigade + `votes:verify` (2.5) → `commons:load` (2.4) → `rank:recompute` + cron (2.6) → edits (2.7) → `engine:eval:db` + database tests (2.9) → ADR re-measure + CI (2.8) → docs (2.10). Defaults D-32..D-36, gate D-37; `docs/phase-3-tasks.md` written for review.
- **Gate output:** `engine:eval:db` 12/12 files from stored rows, 5,000/5,000 paths equal, `votes:verify` clean, one `BrigadeSignal`, `commentCount` exact; `npm test` 238/238 (40 files); lint 0; typecheck clean; `foundation:drift` clean; `engine:lint` OK incl. the new single-writer rule. **CI green on PG 17** (migrate diff clean, eval:db, measurement, vitest, e2e): https://github.com/shanelabountyai/commons/actions/runs/40946970972 on 3161dfe.
- **ADR-001 on PG 17:** path 0.914 vs closure 1.793 ms median (1.96×); stop not fired; table copied into the ADR.
- **One CI finding fixed:** `prisma migrate diff` cannot round-trip a `text_pattern_ops` index (run 96f686d posted the diff on PR #1); replaced by `COLLATE "C"` on `path` (D-34), migration amended in place before any merge or deploy.
- **Sandbox:** everything ran locally except `migrate diff` (CI) and `check-modules` (rsync); Postgres restarted with `service postgresql start`; `engine:eval:db` takes 78 s locally.

| CI run | Head | Result |
|---|---|---|
| Phase 2 head | 3161dfe | **success** https://github.com/shanelabountyai/commons/actions/runs/40946970972 (PG 17 ADR table posted as a PR comment) |
| D-34 trigger | 96f686d | failure at migrate diff (the opclass index), diff posted on PR #1 |
| Phase 1 head | c61c198 | success https://github.com/shanelabountyai/commons/actions/runs/40930385079 |
| Red proof (PR #2, closed) | 4f35a34 | failure at `engine:eval` https://github.com/shanelabountyai/commons/actions/runs/40930587231 |

**Decisions needed from Shane before Phase 3** (`docs/phase-3-tasks.md`): the markdown + sanitizer pair (a new dependency; 3.2 asks in-session), limits storage (new `LimitHit` sliding-window table vs the foundation's fixed-window counter), and whether uploads stay in Phase 3 or move to Phase 4 with the UI. Also: confirm or reverse D-32..D-36.

**By hand (Shane):** delete `gate-proof-red`; push the `v1.4.0` tag from the Mac; merge saas-foundation PR #9; PR #1 stays unmerged until reviewed; build-log card #16 → in progress (repo + PRD links).

---



**Kickoff session (2026-10-29, cloud, Shane present).**
- Owner decisions: public repo, homelab theme, Commons runs alone (D-1..D-3).
- Kit: PRD v1.1 (homelab, Footnote replaces "Askboard" in P1-4, phasing amended per D-6), CLAUDE.md, KICKOFF.md, decisions D-4..D-18 + O-1..O-3, domain brief, ADR-001 (proposed), overlap check, Phase 1 tasks, `rules/ranking.json`, `rules/limits.json`, `tools/rankinglib.py` + `tools/golden_answers.py`.
- Gate output: `python3 -I tools/golden_answers.py` → `18 cases OK`. Two values hand-checked: hot(50, 0, T0) = 14650.6766811, wilson(70, 100) = 0.60415.
- Template: v1.4.0 is the latest tag (D-4). Port 7500 verified free and added to the `~/.claude/CLAUDE.md` port table on the Mac 2026-10-29 (D-5).
- Not done here: no template clone, no `npm ci`, no app code. `main` doesn't exist on origin yet; the Phase 1 session pushes the untouched template v1.4.0 as `main` and builds on `phase-1`.

**Mac session (2026-10-29):** port row added; reuse scan run (D-19): Handhold is a moderation-queue donor the overlap doc had missed; flat comments and a regex sanitizer there are not donors. KICKOFF step 2 now names the sibling clone folder `~/Projects/commons-app`.

**By hand (Shane):** see KICKOFF.md § Still to do by hand.
