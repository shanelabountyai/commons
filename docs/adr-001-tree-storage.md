# ADR-001 — Comment tree storage

**Status:** Proposed. Decided in Phase 1 task 1.6 by measurement (O-1). The default if the measurement is a wash is materialized path.

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

## Decision record (filled in by task 1.6)

- Measurement: 1,000-comment fixture thread, full-subtree fetch, median of 20 runs, both strategies, same machine: _pending_
- Segment width and alphabet: _pending_ (default 6 chars base-36 = 2.18 billion siblings per parent)
- Decided by: _pending_
