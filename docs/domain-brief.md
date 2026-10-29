# Commons — Domain Brief

Vocabulary, formulas and the golden-case index. `docs/decisions.md` outranks this file; the PRD is below both.

## 1. Vocabulary

| Term | Meaning |
|---|---|
| Board | A topic area (D-2). Owns posts. |
| Post | Root of a thread; has a title, body, and optional link. Ranked by Hot/Top/New. |
| Comment | A node under a post or another comment. Ranked among siblings by Best (default), Top or New. |
| Node | Post or comment, when the rule applies to both. |
| Path | The node's position from its post: one fixed-width segment per ancestor (ADR-001, if materialized path). |
| Net score | `ups − downs` from vote rows. The denormalized count is a cache (`votes:verify`). |
| Contribution | A post or comment the user authored that is not removed. Used by the gates (D-15). |
| Young account | Under 24 h old **or** fewer than 5 contributions (D-15). |
| `[deleted]` / `[removed]` | Author deletion / moderator removal. Both keep the subtree (D-13). |
| Continue thread | The link rendered in place of children below `max_depth_rendered`. |

## 2. Tree rules (T-)

- **T-1** A comment's parent is a post or a comment in the same post. Cross-post parents are refused (`TREE_INVALID`).
- **T-2** Depth = number of comment ancestors; top-level comments are depth 0. No depth limit on storage; render cuts at `max_depth_rendered` (6).
- **T-3** Siblings order by the requested sort (Best/Top/New); ties per D-9.
- **T-4** Thread pagination pages **top-level** comments only (page size 50); each page carries its full subtrees down to the render cut.
- **T-5** Permalink to node X renders X's ancestors (bodies collapsed to one line), X, and X's subtree to the render cut.
- **T-6** Deleted/removed rendering per D-13. Vote rows are never deleted.
- **T-7** Writes go through the tree module only (`src/tree/`); nothing else computes a path or depth.

## 3. Ranking formulas (R-) — the oracle is `tools/rankinglib.py`

- **R-1 Hot** (posts): `s = ups − downs`; `order = log10(max(|s|, 1))`; `sign = 1, 0, −1` by `s`; `hot = round(sign·order + (created − 1134028003)/45000, 7)`. Independent of `now`.
- **R-2 Top**: net score, among nodes with `now − window ≤ created ≤ now`; `all` has no lower bound. Future-dated nodes are excluded.
- **R-3 New**: `created desc`, ties `id asc` only (the `created desc` half of D-9's tiebreak is the sort itself).
- **R-4 Best** (comments): Wilson lower bound with `n = ups + downs`, `p̂ = ups/n`, `z = 1.959963984540054`:
  `(p̂ + z²/2n − z·√((p̂(1−p̂) + z²/4n)/n)) / (1 + z²/n)`; `n = 0 → 0.0`.
- **R-5** Rankings are recomputed by a batch job every 300 s and stored with `ranked_at`; pages show freshness. The pure functions are the source; the stored value is a cache.

## 3a. Gates and limits (L-) — the oracle is `tools/limitslib.py`

- **L-1 Young account** (D-15, D-23): `age_seconds < 24·3600` **or** `contributions < 5`. Exactly 24 h old with 5 contributions is not young.
- **L-2 Downvote gate** (D-15, D-23): allowed when `age_seconds ≥ 24·3600` **and** `contributions ≥ 3`; otherwise `GATED_DOWNVOTE`.
- **L-3 Sliding window**: an action is allowed when the number of counted hits with `now − per_seconds < hit_at ≤ now` is below `max` (`young_max` for a young account). Refused hits are not counted.
- **L-4 retryAfter** (D-24): `max(1, oldest_counted_hit_in_window + per_seconds − now)`, integer seconds.
- **L-5 Contributions** are posts and comments authored and not removed, counted as of `now`.

## 4. Golden cases (`python3 -I tools/golden_answers.py` → `44 cases OK`)

| Id | What it pins |
|---|---|
| GH-01..GH-03 | Decay crossover: a 50-vote post at T0 beats a 5-vote post 12 h later, loses to one 13 h later and to one 24 h later |
| GH-04 | Crossover offset is exactly 45000 s (log10(50/5) × gravity) |
| GH-05 | Net 0 and net −1 score the same (D-11) |
| GH-06 | Net −10 ranks below net 0 at the same instant |
| GH-07 | hot(50, 0, T0) = 14650.6766811 (hand-checked) |
| GW-01..GW-04 | 1/1, 2/2, 1/2 rank below 70/100; 10/10 ranks above |
| GW-05 | n = 0 → 0.0 |
| GW-06..GW-08 | wilson(70,100) ≈ 0.6042, wilson(1,1) ≈ 0.2065, wilson(10,10) ≈ 0.7225 (±5e-5) |
| GT-01..GT-03 | Top window edges: exactly 24 h is in `day`; 24 h + 1 s is not; future-dated is in no window |

| GR-01..GR-02 | Base-36 segments: ordinal 1 → `000001`, 36 → `000010` |
| GR-03..GR-06 | Sibling ordinals follow `(created_at, id)`; path concatenation; depth; ancestors |
| GR-07..GR-09 | D-13: a deleted node with a visible descendant renders `[deleted]` in place; a removed node whose only child is a deleted leaf is omitted with it; totals still count omitted nodes |
| GR-10 | Render cut: a 9-deep chain renders 7 rows and the depth-6 row carries continue-thread |
| GR-11..GR-12 | Pagination: 120 top-level comments → page 2 starts at the 51st and holds 50, page 3 holds 20 |
| GL-01..GL-04 | L-1 young at 23:59:59 / 4 contributions; not young at exactly 24 h / 5 |
| GL-05..GL-07 | L-2 downvote refused at 23:59:59 and with 2 contributions; allowed at exactly 24 h with 3 |
| GL-08..GL-12 | L-3/L-4: young comment limit 2/60 s; retryAfter 58; a hit exactly 60 s old has left the window; 59 s has not; floor 1 s |
| GL-13..GL-14 | Regular comment limit 6/60 s |

## 2b. Vote events (V-) — the oracle is `tools/votelib.py`

Vote rows are events `(voter, node_id, value ∈ +1|−1, cast_at)`, reduced in `(cast_at, file row)` order.
- **V-1** The author's +1 is written at node creation and is fixed; any later event by the author on the own node is `SELF_VOTE` (no self-downvote, no self-unvote).
- **V-2** A −1 by a voter who fails L-2 at `cast_at` is `GATED_DOWNVOTE` and changes nothing.
- **V-3** Same value as the voter's current vote → toggle off (current becomes 0, `TOGGLED_OFF`).
- **V-4** Different value → `SWITCHED`. First vote → `APPLIED`.
- **V-5** Counts are the number of current +1 and −1 per node; ups includes the author's +1. These are the cache `votes:verify` recomputes (Phase 2).

**Embedding goldens as fixture nodes (C-8):** the author's fixed +1 (D-12) is one of the counted ups. `P-GH-50` has 49 other up-voters; `C-GW-1-1` has only the author's vote; `C-GW-70-100` has 69 other ups and 30 downs; `C-GW-10-10` has 9 other ups.

## 5. Fixture hashes (seed 20261029, written 2026-10-29; full values in `fixtures/MANIFEST.json`)

Inputs: 200 users, 6 boards, 500 posts (3 removed), 5,000 comments (96 deleted, 46 removed; `P-THICK` 1,000 deep to 11; `P-CHAIN` 8-deep), 10,607 vote events. Eval instant `NOW = T0 + 7 d = 1793836800`. Outcomes: 10,570 applied, 11 toggled off, 9 switched, 5 `SELF_VOTE`, 12 `GATED_DOWNVOTE` (7 brigade + 5 planted). `verify_fixtures.py` also recomputes every expected file from the inputs.

| File | sha256 (first 16) |
|---|---|
| `boards.csv` | `6f5a9b2171906053…` |
| `comments.csv` | `6eb6c5961a032c12…` |
| `expected_comment_order_best.csv` | `7687c911222f40e9…` |
| `expected_counts.csv` | `c42bf71f3ae441bb…` |
| `expected_limits.csv` | `feec6ecb2dd931eb…` |
| `expected_pages.csv` | `72550010210401c0…` |
| `expected_permalink.csv` | `b0d348457478b80f…` |
| `expected_post_order_hot.csv` | `a12bf9f907ca1193…` |
| `expected_post_order_new.csv` | `ff84e5cb20442617…` |
| `expected_post_order_top_all.csv` | `0b06a1e351841e0a…` |
| `expected_post_order_top_day.csv` | `0e2ac7f064fa69d7…` |
| `expected_post_order_top_week.csv` | `2c94a6c3da16ff41…` |
| `expected_tree.csv` | `a36f24bc18ffb187…` |
| `expected_vote_outcomes.csv` | `adbafe08dc8b7166…` |
| `posts.csv` | `7d2c0ca35893de8c…` |
| `users.csv` | `88df727c6b060a68…` |
| `votes.csv` | `1bd0313ba577f75f…` |
