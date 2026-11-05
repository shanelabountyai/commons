# Phase 7 — community text (drafted 2026-11-04 after the Phase 6 gate, D-96)

Shane chose to regenerate the community fixture before closing the project (D-96), which unlocks the four carried measurements (D-75, D-81, D-93 (3)). Same rules as every phase: fixture before fix, constants as data, signals for humans, nothing sent, no classifier, one concern per commit, never merge. Each task gets a short PRD in `docs/prd/`, reviewed one at a time.

| # | Task | Scope | Must not | Size |
|---|---|---|---|---|
| 7.1 ✅ | **Community bodies, organic reports and reposts** (PRD D-97, approved and built D-98: `docs/prd/7.1-community-bodies.md`) | An additive `fixtures/community/` from a separate seed, with rates fixed in the PRD before any measurement; an oracle; the loader reads the bodies | Change any existing fixture or expected file; change a rule value | M |
| 7.2 ✅ | **The four carried measurements** (PRD drafted D-99, approved D-100, built D-101: `docs/prd/7.2-carried-measurements.md`) | `min_contribution_chars`, the community-report swarm check, link hosts, the repost window, each through the 6.4 bind test; a rule only where it binds | A limit nobody measured; calling an invented distribution a community's | M |
| 7.3 ✅ | **Close the link window's two gaps** (PRD drafted D-103, approved D-104, built D-105: `docs/prd/7.3-link-window-gaps.md`) | Fixtures first for ten uncounted link syntaxes, edited-in links and link swaps; then count what the renderer emits, edits ask the window, history from `LimitHit` | Change a window value; claim the edit side is tested against the community (it has no edits) | M |

Gate for Phase 7: `fixtures:check` reproduces the community text; `engine:eval` stays at 0 differences; every 7.2 number in `docs/EVAL.md` carries the invented-distribution line; CI green; **stop for review**, then the closure prompts.
