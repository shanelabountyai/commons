# Kickoff — Commons (Build Log #16, Community Forum)

Cloud-session variant. Paste the block below into a Claude Code cloud session on Fable (`/model claude-fable-5-1`) with `shanelabountyai/saas-foundation` and `shanelabountyai/commons` attached. The kit is on branch `kickoff` of `commons` (no `main` exists yet). Nothing has been cloned from the template, installed or built.

```
Commons — synthetic homelab community forum (Build Log #16, main track).
The kickoff kit is on branch `kickoff` of shanelabountyai/commons. It holds docs, rules
JSON and a Python ranking oracle only; no app code.

Read, in order, from the kit: CLAUDE.md, prd-commons.md, docs/decisions.md (authoritative),
docs/domain-brief.md, docs/adr-001-tree-storage.md, docs/portfolio-overlap.md,
docs/phase-1-tasks.md.

Steps, in order:
1. Preflight. python3 -I tools/golden_answers.py must end "18 cases OK". If not, stop and
   tell me. Check that port 7500 is not in saas-foundation/CLONES.md; if it is, stop.
2. Clone the template with shared history (NOT the GitHub template button), in a separate
   directory from the kit checkout:
     git clone <saas-foundation url> commons-app && cd commons-app
     git remote rename origin template
     git checkout -B main v1.4.0
     npm ci
     npm run new-project -- commons 7500
   Do not run new-project twice. Add origin = shanelabountyai/commons, push the untouched
   v1.4.0 commit as origin/main (the repo has no main yet), then work on branch `phase-1`.
   Copy the kit files in from the `kickoff` branch checkout (don't merge it; its history is
   unrelated to the template) and commit them. Add the scope-honesty banner from the PRD to
   README.md verbatim.
3. Put ?connection_limit=10&pool_timeout=20 on the local DATABASE_URLs in the env examples
   and the db-setup output. Confirm vercel.json has the house ignoreCommand. Confirm the CI
   workflow sets TZ=America/Chicago. Remove or unwire billing and share links per D-18
   (use foundation:check-modules' path list if there is no switch) and record what you did.
4. npm run foundation:drift must pass before any Commons code exists. Try npm run db:setup
   and npm test (Quorum's sandbox notes are in D-16). If something can't run, record exactly
   which command failed and why in NEXT.md and continue: CI decides.
5. Reuse scan: skipped (not reachable from the cloud). Record that in docs/decisions.md
   with the sentence from CLAUDE.md §Session 0.
6. Read every doc. List anything that contradicts itself or can't be built as written, and
   any donor path in docs/portfolio-overlap.md you could not find. Don't resolve these yourself.
7. Plan first: write docs/phase-1-plan.md with the order you'll do tasks 1.1 to 1.11 in,
   which donor you'll read for each port in 1.3, how you'll run the ADR-001 measurement in
   1.6 given what the sandbox has, and which commands you expect to be CI-only.
8. Then build Phase 1 (tasks 1.1–1.11) in TDD order. Commit on the branch, naming files
   explicitly (never git add -A), one concern per commit. Push `phase-1` and open a PR against main. Do not merge.
   Open a separate PR on saas-foundation adding the CLONES.md row:
   commons | shanelabountyai/commons (public) | v1.4.0 | 2026-10-29; homelab community forum:
   path-encoded comment trees, Hot/Top/New/Best (Wilson), one-vote constraint, rate limits as
   data, mod queue; port 7500; synthetic only; not deployed; tools/ (Python stdlib oracles),
   fixtures/, rules/ are clone-owned.
9. At the Phase 1 exit: run the "Before Phase 2" check in docs/phase-1-tasks.md, write
   docs/phase-2-tasks.md, update NEXT.md, and stop. Show me both PR links, the engine:eval
   output, the ADR-001 measurement and the contradictions list.

Rules from the first commit: engines under src/tree, src/ranking, src/votes, src/limits are
pure (now is a parameter); tree writes only via the tree module; vote rows are truth; one
account one vote by DB constraint; constants are data in rules/; fixtures are frozen and never
written by product code; never edit an expected value to pass a test; never edit
template-owned paths; no new dependencies without asking; never "secure", "spam-proof" or
"fair" without the number; branch + PR, never merge.
```

## Still to do by hand

- `~/.claude/CLAUDE.md`: add the port-table row (commons → 7500) on the Mac.
- Review and merge the two PRs (commons; saas-foundation CLONES row).
- Build-log card #16: name **Commons**, PRD and repo links, status `in progress`.
- Decide O-1..O-3 when they come up; the defaults are in force until then.
- Re-run `reuse-scan.py` the next time the repo is open on the Mac and record the result.
