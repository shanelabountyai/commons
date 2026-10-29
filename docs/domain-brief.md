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
- **R-3 New**: `created desc`, ties per D-9.
- **R-4 Best** (comments): Wilson lower bound with `n = ups + downs`, `p̂ = ups/n`, `z = 1.959963984540054`:
  `(p̂ + z²/2n − z·√((p̂(1−p̂) + z²/4n)/n)) / (1 + z²/n)`; `n = 0 → 0.0`.
- **R-5** Rankings are recomputed by a batch job every 300 s and stored with `ranked_at`; pages show freshness. The pure functions are the source; the stored value is a cache.

## 4. Golden cases (`python3 -I tools/golden_answers.py` → `18 cases OK`)

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

Task 1.2 adds tree cases (GR-) and the fixture hashes as §5.

## 5. Fixture hashes

Written by task 1.2 after the first `tools/build_fixtures.py --seed 20261029` run. Empty until then.
