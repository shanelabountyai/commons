# ADR-001 — Comment tree storage

**Status:** Accepted 2026-10-29 by measurement (D-26, confirmed by Shane D-28, closes O-1): **materialized path**. Re-measured on the Prisma schema on CI's Postgres 17 in Phase 2 (below); the stop in task 2.8 did not fire.

## Context

Comments nest arbitrarily deep (T-2). The reads that matter:
1. **Thread page:** one post, top-level page of 50, each with its full subtree to depth 6, siblings ordered by Best/Top/New (T-3, T-4).
2. **Permalink:** ancestors of X, plus X's subtree (T-5).
3. **Counts:** comment total per post.

The writes are inserts (reply), status changes (delete/remove), and vote-count cache updates. Nodes **never move**; there's no reparenting feature. That point carries most of the decision.

## Options

| | Materialized path | Closure table | Adjacency list + recursive CTE |
|---|---|---|---|
| Shape | `path` text on each comment, one fixed-width base-36 segment per ancestor; `LIKE 'p%'` on a `text_pattern_ops` index | Separate `(ancestor, descendant, depth)` table, one row per pair | `parent_id` only |
| Subtree read | One indexed range scan | One join on the closure table | Recursive CTE, one step per level |
| Ancestors | Parse the path (no query) | One query | Recursive CTE |
| Insert | One row; path = parent's path + new segment | 1 + depth rows | One row |
| Move a subtree | Rewrite every descendant's path | Delete + reinsert pairs | One update |
| Sibling ordering by a **changing** score | Not encoded in the path; sort in the query or in memory | Same | Same |
| Storage | O(n · depth) chars | O(n · depth) rows | O(n) |

## Leaning, and what would change it

**Materialized path**, because nodes never move (its one weakness doesn't apply), subtree and ancestor reads are a single scan or a string parse, and there's no second table to keep consistent. The path encodes structure only; ranking order is applied after the fetch, because Best changes with every vote.

What would flip it to closure table: the 1,000-comment fixture thread taking materially longer by path scan than by closure join on the same Postgres, or a P1/P2 need to move subtrees (none today).

## Decision record (task 1.6, 2026-10-29)

Measured by `npx tsx scripts/adr-001-measure.ts` on **PostgreSQL 16.15** (sandbox; CI is 17, C-3/D-22), the `P-THICK` fixture thread (1,000 comments, max depth 11) loaded both ways into a throwaway database, `EXPLAIN (ANALYZE, BUFFERS)` execution time, 20 runs after one warm-up:

| Query | Materialized path | Closure table |
|---|---|---|
| Whole thread (1,000 rows), median / p95 | **0.808 / 0.871 ms**, 10 shared buffers | 1.341 / 1.390 ms, 34 buffers |
| Permalink subtree (12 rows), median / p95 | **0.036 / 0.068 ms**, 3 buffers | 0.178 / 0.206 ms, 12 buffers |
| Storage (table + indexes) | **232 KiB** | 672 KiB (152 + 520; 3,376 closure rows) |

- **Decision: materialized path.** Faster on both reads, a third of the storage, one table, and nodes never move. The closure table's one advantage (cheap subtree moves) is a feature Commons doesn't have.
- **Segment:** 6 characters, base-36 `0-9a-z`, ordinal = creation order among siblings by `(created_at, id)`; 2.18 billion siblings per parent. Depth = segments − 1. Index: `(post_id, path text_pattern_ops)`; subtree = `path LIKE prefix || '%'`; ancestors are parsed from the path with no query.
- **Caveats, stated:** 1,000 comments fit in shared buffers either way (every run `read 0`), so this measures CPU and plan shape, not I/O; both are sub-2 ms and a product would not feel the difference at this size. The decision rests on the structural argument above as much as the numbers. Measured on 16, not 17.
- Decided by: the kickoff build session, as the plan's default (D-26), confirmed by Shane (D-28).

## Phase 2 re-measurement on the real schema (task 2.8, 2026-10-29)

`npm run adr:measure:db` against the Prisma `Comment` table (test database loaded with all 5,000 comments by `engine:eval:db`) versus a TEMP closure table built from the same rows, 20 runs after a warm-up. Path column `COLLATE "C"` (D-34), no operator-class index.

| Query | PG 17.11 (CI, run 40946970972) path / closure | PG 16.15 (sandbox) path / closure |
|---|---|---|
| Whole thread, median | **0.914** / 1.793 ms (1.96×) | **1.004** / 1.904 ms (1.90×) |
| Whole thread, p95 | 1.112 / 2.496 ms | 1.100 / 2.100 ms |
| Permalink subtree, median | **0.028** / 0.048 ms | **0.041** / 0.067 ms |
| Storage | Comment 3,672 KiB (all 5,000 rows + 3 indexes); closure 520 KiB (P-THICK only) | 4,048 KiB; 520 KiB |

Both thread queries read 296 buffers on both versions: at this table size the planner scans rather than seeks, so the ratio is sort-and-join cost. The decision stands. Re-check only if a thread grows past ~10⁵ comments or a move-subtree feature appears.
