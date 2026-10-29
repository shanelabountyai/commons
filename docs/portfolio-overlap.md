# Commons — Portfolio Overlap Check

Checked 2026-10-29 against the build-log card list, `saas-foundation/CLONES.md`, and the Quorum, Ledgerleave and Coursework kits. Donor source trees for private repos were **not** read from the kickoff session; the first session reads each donor before porting ("port before you write").

## Verdict

| Card chip | Already in the portfolio? | What Commons does instead |
|---|---|---|
| comment trees | **No.** Coursework has a prerequisite DAG (graph, many parents); nothing has a single-parent tree of user content with pagination and permalinks | Path-encoded trees, render cut, continue-thread, removed-node rules |
| ranking algorithms | **No.** Pulseboard aggregates; Triage classifies; nothing orders content by a decaying score | Hot / Top / New / Best (Wilson), oracle-checked |
| moderation queue | **Yes (found by the reuse scan, D-19).** Handhold (`~/Projects/alongside/backend/src/community/`) has reports with reason rows, a mod queue with moderator step-up, and an append-only `ModerationAction` audit with a test. Triage routes inbound items to a queue | Reports with reason codes, state machines for content and users, append-only mod log |
| rate limiting | **Partly.** The foundation's `src/core/rate-limit.ts` is a general fixed-window Postgres counter (`hit(key, {limit, windowMs})`, `RateLimit` table, hourly sweep) used by login, MFA, invites and share reads. Not sliding, not pure: a Phase 3 **storage** donor, not an engine donor | Per-user, per-action sliding windows from data, young-account gates, honest retry-after |

Suggested card chips once it ships: `comment trees (path-encoded)` · `hot / top / new / best (Wilson)` · `one account, one vote` · `rate limits as data` · `XSS fixture suite inert` · `mod queue + append-only log`.

## Reuse — port, do not rebuild

| Capability | Donor | Read first | Commons use |
|---|---|---|---|
| Auth, orgs, roles, invites, audit, outbox, cron, CI, invariants | saas-foundation v1.4.0 | template | As cloned (D-18) |
| Pure engine + forbidden-import lint | Quorum (`scripts/tally-lint.ts`, `src/tally/`), Bracketry | quorum is public | `npm run engine:lint` over `src/tree/` and `src/ranking/` |
| Frozen fixtures + stdlib Python oracle + golden answers + manifest + `fixtures:check` | Quorum, Gavel | quorum `tools/`, `package.json` `fixtures:check` | Same workflow |
| Own CSV reader (no dependency) | Quorum `src/tally/csv.ts` | quorum | Fixture loaders |
| Batch recompute with freshness | Pulseboard (pre-aggregation), foundation cron | pulseboard rollups | Ranking job (R-5), Phase 2 |
| Honest measurement write-ups | Pulseboard | its WRITEUP.md | 1,000-comment retrieval timing |
| Append-only tables via triggers | Quorum D-19, Housefile | quorum migrations | Votes (soft toggle as new rows or a guarded table, Phase 2 decides), mod log, edit history |
| State machine as data, illegal transitions refused | Quorum D-22 violations, Adjuster | quorum `src/` violations | Content + user moderation states (Phase 4) |
| Outbox notices queued, never sent | Quorum D-44 | quorum | Ban and report notices |
| Reports with reason codes as rows, mod queue, append-only moderation audit + its test | Handhold (D-19) | `~/Projects/alongside/backend/prisma/schema.prisma` `ReportReason`..`ModerationAction`; `tests/community.security.test.ts` §10.11 | Moderation vocabulary (1.3) and Phase 4. Not a donor for trees, the sanitizer or the limits engine (see D-19) |

## New — each with the fixture that proves it

| # | Lesson | Proven by |
|---|---|---|
| 1 | Tree storage chosen by measurement | ADR-001 decision record; 1,000-comment timing |
| 2 | Ranking with time decay and small-sample honesty | GH-01..GH-07, GW-01..GW-08 |
| 3 | One vote per account, enforced by the database | Unique constraint test; `votes:verify` clean after the brigade fixture |
| 4 | Hostile input made inert | XSS fixture set (Phase 3) |
| 5 | Abuse throttled by design | Spam-bot vs normal-user suites (Phase 3) |
