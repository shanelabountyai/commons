# Commons — closeout (written at the Phase 4 gate, 2026-10-29)

The PRD names four phases; this closes the build. Branch `phase-1`, PR #1 against `main`, **not merged**. Everything below is measured on synthetic fixtures by the same author who wrote the spec, which is the scope banner's point.

## What shipped

| Phase | What | Proof |
|---|---|---|
| 1 | Pure engines: Wilson and hot math, rules loader, materialized-path tree with render rules, vote reducer, sliding-window limits; stdlib-Python oracles; frozen fixtures; `engine:eval` | 44 golden cases OK; 12 expected files / 19,568 rows / 0 differences |
| 2 | Schema, the unique vote constraint, single tree writer, `votes:verify`, batch ranking snapshots, `commons:load`; ADR-001 measured on Postgres 17 in CI | `engine:eval:db` 0 differences from stored rows |
| 3 | 59 XSS fixtures written before the renderer; `src/render` as the only sanitizer; `LimitHit` store; the action door with coded refusals; abuse suites | `xss:check` 59/59; `abuse:spam` 2/1/20 allowed, `abuse:normal` 0 refused |
| 4 | Reports, cases, the append-only log, state machines as data, duplicate signal, pages (boards, board tabs with `rankedAt`, thread, permalink, profile, search, mod queue), uploads, the browser capstone, the demo | 316/316 vitest; harness 14/14; e2e 5/5 with axe 0 light+dark; `docs/DEMO.md` |

Full numbers with their commands: `docs/EVAL.md`. Decisions D-1..D-55: `docs/decisions.md`. The adversarial angle: `WRITEUP.md`.

## What it does not do (out of scope, stated)

No deploy (synthetic data; D-51 names the one seam). No email or notifications. No classifier; the brigade and duplicate signals are for a human. No semantic search. No block-user (P1-2's second half). Hot and Best constants untuned. Moderator is a Profile flag because `Role` is template-owned (D-48).

## By hand (Shane)

1. Review PR #1 (Phases 1–4, one branch); decide whether to merge. Nothing merges from a session.
2. Reverse any of D-48..D-54 (Phase 4 session defaults) if they are not what you want; D-41..D-46 (Phase 3) likewise if not yet confirmed.
3. On the Mac: re-run `~/Projects/reuse-scan.py` on the finished repo (the Session 0 note asked for it "before Phase 4"; the cloud session cannot run it); add the commons row to `saas-foundation/CLONES.md` if the local checkout lacks it.
4. Upstream to saas-foundation: (a) a `security:` release bumping `next` (critical), `prisma`, `zod`, `vitest`/`vite` — 15 advisories on this head, 0 from Commons (D-54); (b) a documented clone extension point for `Role`/permissions, or every clone that needs a role invents a flag (D-48).
5. Build-log card #16 to shipped; brief artifact and LinkedIn drafts (see below).
6. Optional: delete the `migrate diff` / ADR PR comments CI posted on PR #1 once read.

## Still to do for closure (house definition of done)

- [x] `docs/DEMO.md` with every number from a named command
- [x] `docs/EVAL.md` §Phase 4
- [x] `WRITEUP.md`
- [ ] Exec brief artifact, *Commons in Brief* — not made from the cloud session; Shane to ask for it or make it from `WRITEUP.md`
- [ ] LinkedIn drafts — not drafted here (the house ledger is on the Mac)
- [x] Cost review (2026-10-29; no Vercel, Neon or blob project exists for this repo):
  - Vercel project / auto-deploy: **none**. `vercel.json` carries the house `ignoreCommand` for the day one exists.
  - GitHub Actions: push and PR only, no `schedule`. **Keep.** Each run: ~8 min on PG 17 including the e2e capstone.
  - Database beyond the laptop: **none**; tests use local Postgres. LLM calls and keys: **none**. Uploads: local disk under `var/`, gitignored. Baseline: $0 by absence.
- [x] NEXT.md stop state
