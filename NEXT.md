# NEXT

## ▶ STOPPED after the plan (2026-10-29). Shane reviews `docs/phase-1-plan.md`; no product code until he says go.

**Cloud kickoff session (2026-10-29, Fable, Shane present) — KICKOFF steps 1–9.**
- Preflight: `18 cases OK`; 7500 not in CLONES.md.
- Template cloned with shared history (68 commits), remote `template`; untouched **v1.4.0 (e0053a1) pushed as `origin/main`**; work on **`phase-1`**: scaffold (new-project rewrite), kit copied from `kickoff` f74131b, scope banner in README, billing removed per D-18, share links unwired, notifications kept (D-20).
- Gate output (local): `foundation:drift` clean against v1.4.0 (modules removed: billing); `lint` 0 problems; `typecheck` clean; **vitest 189/189 (34 files)** under `TZ=America/Chicago`.
- Sandbox record (D-20): Prisma engine downloads blocked (403) → `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate`; with that stub `migrate deploy` is a silent no-op, so migrations were applied with `psql -f`; local Postgres is **16.15** (CI: 17); `foundation:check-modules` needs `rsync` (CI-only); Chromium at `/opt/pw-browsers`.
- Reuse scan not repeated (D-19). Secret check before push: only `.env.example` plus two template source files whose names contain "secret".
- **Written for review:** `docs/phase-1-plan.md` — build order, donors per port, ADR-001 measurement plan on PG 16, CI-only list, **8 contradictions C-1..C-8**, 4 donor paths unreadable from the cloud, proposed fixture shape, defaults to be taken on go.
- PRs (neither merged): commons **#1** https://github.com/shanelabountyai/commons/pull/1 (`phase-1` → `main`); saas-foundation **#9** https://github.com/shanelabountyai/saas-foundation/pull/9 (CLONES.md row).

**Decisions needed from Shane before go:** C-1 (fixtures:check between 1.1 and 1.2), C-3 (measure ADR-001 on PG 16 or defer), C-5 (young-account boundary + key names), C-7 (retryAfter definition); C-2, C-4, C-6, C-8 are doc fixes the session can make on go. Also: veto or accept the proposed fixture shape.

---

**Kickoff session (2026-10-29, cloud, Shane present).**
- Owner decisions: public repo, homelab theme, Commons runs alone (D-1..D-3).
- Kit: PRD v1.1 (homelab, Footnote replaces "Askboard" in P1-4, phasing amended per D-6), CLAUDE.md, KICKOFF.md, decisions D-4..D-18 + O-1..O-3, domain brief, ADR-001 (proposed), overlap check, Phase 1 tasks, `rules/ranking.json`, `rules/limits.json`, `tools/rankinglib.py` + `tools/golden_answers.py`.
- Gate output: `python3 -I tools/golden_answers.py` → `18 cases OK`. Two values hand-checked: hot(50, 0, T0) = 14650.6766811, wilson(70, 100) = 0.60415.
- Template: v1.4.0 is the latest tag (D-4). Port 7500 verified free and added to the `~/.claude/CLAUDE.md` port table on the Mac 2026-10-29 (D-5).
- Not done here: no template clone, no `npm ci`, no app code. `main` doesn't exist on origin yet; the Phase 1 session pushes the untouched template v1.4.0 as `main` and builds on `phase-1`.

**Mac session (2026-10-29):** port row added; reuse scan run (D-19): Handhold is a moderation-queue donor the overlap doc had missed; flat comments and a regex sanitizer there are not donors. KICKOFF step 2 now names the sibling clone folder `~/Projects/commons-app`.

**By hand (Shane):** see KICKOFF.md § Still to do by hand.
