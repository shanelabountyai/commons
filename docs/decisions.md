# Commons — Resolved Decisions & Open Items

The PRD leaves several rules open. This file closes them, and **it outranks PRD text.** If you change a decision, change `tools/`, `rules/`, the brief and the fixtures deliberately, not the tests.

## Owner decisions (Shane, 2026-10-29)

| # | Decision | Why |
|---|----------|-----|
| D-1 | **Public GitHub repo `shanelabountyai/commons`. Synthetic data only.** Every user, post, comment, vote and report comes from `tools/build_fixtures.py --seed 20261029`; emails on `example.com`; the community is invented. Scope-honesty banner verbatim in README. | A public repo must be safe to read |
| D-2 | **Theme: homelab.** Boards: `selfhosting`, `networking`, `hardware`, `sbc` (small-board computers), `help`, `meta`. Seed text is technical Q&A and build logs, which make deep threads and believable spam (affiliate links, crypto-mining "guides", fake support numbers). | Owner's call; technical threads make deep nesting and the spam wave plausible |
| D-3 | **Commons runs alone**, not in parallel with Ticketing (#13). | Owner's call: review load |

## Kickoff defaults (set at kickoff, 2026-10-29; reversible)

| # | Decision | Why |
|---|----------|-----|
| D-4 | **Stack:** clone of saas-foundation **v1.4.0** (latest tag at kickoff; Quorum/Ledgerleave/Coursework started on v1.3.0) via git with shared history, remote `template`. Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright. Python only in `tools/`, stdlib only, run with `python3 -I`. Template-owned paths never edited. | House rules |
| D-5 | **Port 7500, verified free 2026-10-29.** Checked on the Mac: not in the `~/.claude/CLAUDE.md` port table, no sibling `package.json` uses it, nothing listening; row added to the table. Originally proposed unverified: Not in `saas-foundation/CLONES.md` or the sibling repos (6100 gavel, 6200 quorum, 7300 ledgerleave, 7400 coursework, 5800 footnote, 5900 housefile). The port table's "next free hundred" was 6300 per quorum NEXT.md, but **triage runs an HTTP handler on :6300**, so 6300 is avoided. | Avoid a known collision |
| D-6 | **Phase 1 is pure engines + oracle agreement with no database writes** (the PRD's original phase 1 "trees + ADR + fixtures" plus the ranking math). The PRD's TDD note puts Wilson + decay first, and the Quorum/Gavel pattern proved that an engine-first phase gives a clean, reviewable gate. | House pattern |
| D-7 | **Time is integer epoch seconds (UTC) inside the engines**, passed in, never read. `now` is a parameter; nothing under `src/tree/` or `src/ranking/` calls `Date.now()` or `new Date()`. The UI formats; the engines don't. Fixture anchor `T0 = 1793232000` (2026-10-29T00:00:00Z). | Ranking must be reproducible; Quorum's string-axis rule fits calendar dates, while ranking needs arithmetic on seconds |
| D-8 | **Ranking constants are data** in `rules/ranking.json`: hot epoch 1134028003, gravity 45000 s (one order of magnitude of net score = 12.5 h of age), Wilson z = 1.959963984540054 (95%), Top windows day/week/all, recompute every 300 s. Changing one needs an entry here and a golden case. | PRD P0-3 |
| D-9 | **Rankings are floats; the engine must match the oracle to 1e-7 (hot) and 5e-5 (Wilson) and must produce the identical ordering on every fixture.** Ordering ties break on `(created_at desc, id asc)`, the only deterministic tiebreak in the system. Ordering is what users see; the score is an implementation detail shown only in the eval. | Floats are fine here (this isn't money), but order must be deterministic |
| D-10 | **Never edit an expected value to pass a test.** Golden values come from `tools/golden_answers.py`, derived from the closed forms in `docs/domain-brief.md` §3. Two were hand-checked at kickoff: hot(50, 0, T0) = 14650.6766811 and wilson(70, 100) = 0.60415. If TypeScript disagrees, stop and show both derivations. | House rule |
| D-11 | **Known quirk kept, not fixed:** under the hot formula, net 0 and net −1 at the same instant score the same (`log10(max(\|s\|,1)) = 0`). GH-05 pins it so nobody "fixes" it silently. | Published-formula fidelity |
| D-12 | **Self-vote:** the author's +1 is written on create and cannot be removed or switched. It counts in Hot and in Best's `n`. | PRD P0-2 asked for the choice to be explicit |
| D-13 | **Removed nodes keep their subtree.** Author delete renders `[deleted]`, mod remove renders `[removed]`; both keep position, children, and vote rows. Body and author are hidden from non-mods in both cases. A deleted or removed leaf with no visible descendants is omitted from the rendered tree but still counts in comment totals. | PRD P0-1 fixture; the leaf rule avoids walls of "[deleted]" |
| D-14 | **Banned users' existing content stays visible** unless separately removed. A ban stops new writes (posts, comments, votes, reports) with a clean `BANNED_UNTIL <ts>` refusal. | PRD P0-5 asked for the policy to be documented; a ban punishes behavior, not history |
| D-15 | **Rate limits and gates are data** in `rules/limits.json`. A young account is under 24 h old **or** has fewer than 5 contributions. Downvoting needs ≥ 24 h and ≥ 3 contributions. Edit window 900 s. Render depth cut at 6, below which a "continue thread" link appears. Uploads ≤ 2 MB, png/jpeg/webp only. | PRD P0-2/P0-4/P0-6 left N open |
| D-16 | **Built unattended in a cloud session, delivered as branch + PR, never merged by the agent. CI is the gate.** If the sandbox can't download Prisma engines or Playwright browsers, record it in NEXT.md. (Quorum found Chromium preinstalled at `/opt/pw-browsers` and used `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate`; try those first.) | House rule |
| D-17 | **Model pinned to Claude Fable 5.1** (`claude-fable-5-1`) in `.claude/settings.json`. | Matches the last five builds |
| D-18 | **Foundation modules:** keep orgs (one org = one forum instance), roles (owner/admin = forum admin; a `moderator` role is clone-owned, Phase 4), invites, audit log, notifications/outbox (report and ban notices queued, never sent). **Billing and share links removed or unwired**, recorded here. Take v1.4.0's `filterListedOrgs` hook as-is (default). | Nothing is billed or shared out |

## Open — the first session proposes, Shane decides

| # | Question | Default if nobody decides |
|---|----------|---------------------------|
| O-1 | Tree storage: materialized path vs. closure table (ADR-001). | Materialized path with fixed-width base-36 segments, **decided by the Phase 1 measurement** in task 1.6, not by preference |
| O-2 | Does a removed parent's subtree stay votable and replyable? | Votable yes, replyable no (thread-local lock under a removed node) |
| O-3 | Brigade signal for the mod queue: flag N downvotes from young accounts on one item within M minutes? | Yes: ≥ 5 within 10 min, queued with reason `SUSPECTED_BRIGADE`, no automatic action |

## Lineage (filled in by the session as it ports)

| Port | Donor path | Commit |
|------|-----------|--------|
| — | — | — |
