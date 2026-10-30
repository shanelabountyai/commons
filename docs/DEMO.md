# Commons — the demo (three acts)

> **Scope.** Synthetic data only. No scraped content, no real users. Passing the abuse fixtures shows the defenses stop the attacks the author thought of, nothing more. Nothing is deployed and nothing is sent.

Every number below was printed by the command named next to it on 2026-10-29 against local PostgreSQL 16.15 (CI re-runs the same commands on 17). Run it yourself:

```sh
service postgresql start                       # cloud sandbox only
npm run db:setup                               # databases + migrations (prisma migrate deploy; psql -f in the sandbox, D-16)
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npm run commons:demo        # ~2 min; prints all three acts and the org URL
npm run dev                                     # then open the printed /o/<org>/f as an owner (D-8 demo sign-in)
```

`commons:demo` makes a **fresh org per run** (`demo-<yyyymmddHHMM>`). It cannot rebuild one in place: an org that holds moderation-log rows cannot be deleted, because the append-only trigger refuses the cascade too (D-49). The seed is the frozen fixture (500 posts, 5,000 comments, 10,607 vote events; 16,457 rows in all) written **through the real writers** in 71 s.

---

## Act 1 — the same seed under Hot, Top and New

The board `selfhosting`, ranked at the fixture instant (2026-11-05T00:00:00Z, the same `now` `engine:eval` and the Python oracle use). `rank:recompute` scored 500 posts and 5,000 comments; the page shows `rankedAt` next to the tabs, so a reader can tell a snapshot from a live score.

| Hot (reddit formula, gravity 45,000 s) | Top all time (net) | New |
|---|---|---|
| P-0135 · net 7 · 6 h | **P-GH-50 · net 50** · 168 h | P-0135 · 6 h |
| P-0188 · net 4 · 11 h | P-0206 · net 35 · 868 h | P-0340 · 10 h |
| P-0369 · net 4 · 11 h | P-0119 · net 23 · 185 h | P-0188 · 11 h |
| **P-0340 · net 0 · 10 h** | P-0019 · net 16 · 92 h | P-0369 · 11 h |
| P-0343 · net 14 · 27 h | P-0309 · net 16 · 190 h | P-0316 · 24 h |

What to point at: a post with **net 0 at 10 h outranks net 14 at 27 h under Hot** — 17 hours of age is worth 61,200 / 45,000 = 1.36 on the log scale, more than log10(14) = 1.15. That is the formula doing exactly what `rules/ranking.json` says, not a bug; whether it is a good ordering for a homelab board is the open question `docs/EVAL.md` refuses to answer. The oracle agrees on every row of all three orders (`npm run engine:eval`: 12 files, 19,568 rows, 0 differences; `engine:eval:db` the same from stored rows).

## Act 2 — a spam wave through the door

An account **1 hour old** (young: under 24 h and under 5 contributions) posts 60 comments in 60 s and 5 posts in the hour, every one through `submitComment` / `submitPost`, the only user-facing write path (D-44).

| Attempts | Allowed | Refused `RATE_LIMITED` | First `retryAfter` | Rule |
|---|---|---|---|---|
| 60 comments / 60 s | 2 | 58 | 58 s | `comment` young_max 2 per 60 s |
| 5 posts / 1 h | 1 | 4 | — | `post` young_max 1 per 3,600 s |

The two comments that got through had the same body, so the second raised **one `DUPLICATE` signal** (24 h window, ≥ 40 chars, D-45/P1-3). The queue went from one item (the fixture's own brigade on P-BRIGADE, loaded with the seed) to two: `DUPLICATE on spam-1, BRIGADE(7 voters) on P-BRIGADE`. Refusals write no rows, so a spammer being refused does not extend their own window (D-45). Same numbers as the pure engine and `fixtures/expected_limits.csv` (`npm run abuse:spam`).

## Act 3 — a brigade, one signal, remove, restore, the log

Seven accounts **2 hours old** each downvote `P-GW` within ten minutes.

- Outcomes: `GATED_DOWNVOTE` × 7. Every vote is **recorded** as an event row (vote rows are truth) and **not counted**: P-GW's `downs` stays 0, `ups` 1 (the author's fixed +1, D-12). The downvote gate is 24 h and 3 contributions.
- ≥ 5 gated downvotes on one node inside 600 s raises **one** `BRIGADE(7 voters)` item (D-31), however many more arrive.
- A 30-day-old member reports the post as `harassment` → `CASE(1 report)`. Queue: `CASE on P-GW, DUPLICATE on spam-1, BRIGADE(7) on P-BRIGADE, BRIGADE(7) on P-GW`, each with author history beside it.
- The owner reviews the signal, removes, then restores: `REMOVE OPEN→REMOVED`, `RESTORE REMOVED→RESTORED` — transitions come from `rules/moderation.json`; an illegal one is `TRANSITION_INVALID`.
- The log afterwards, oldest first: `REVIEW_SIGNAL`, `REMOVE`, `RESTORE`, each with actor, reason and time. `DELETE FROM "ModerationAction"` is **refused by trigger `commons_append_only`; rows still 3**. The queue after review: the duplicate and the fixture's brigade remain; P-GW's items are gone.

In the browser (`e2e/commons.spec.ts`, the Phase 4 capstone, 5/5 in 3.2 min): the same walk through the pages, plus all 48 markdown-class XSS fixture bodies posted through the real comment form — 47 stored and inert in Chromium (no `script`/`img`/`svg`/`iframe`/`on*`/`javascript:` survives inside a rendered body, no dialog fires), and X-37 (a NUL byte inside a script tag) refused `INPUT_INVALID` at the door. That last one was a 500 until the capstone found it (commit `08b65e6`); the failing test was written before the fix, as rule 7 says. axe: 0 violations in light and dark on all 10 page loads.

## What this demo does not show

It does not show the forum under load, a real community's behaviour, or an attacker who has read `rules/limits.json`. The three acts are the three attacks the author scripted; the fixtures are the author's imagination of hostility. The constants are reddit's historical ones, untuned. See `docs/EVAL.md` §"What these numbers are not".
