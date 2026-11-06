# Commons — the demo (four acts)

> **Scope.** Synthetic data only. No scraped content, no real users. Passing the abuse fixtures shows the defenses stop the attacks the author thought of, nothing more. Nothing is deployed and nothing is sent.

Every number below was printed by the command named next to it on **2026-11-05** (re-run at closure, D-107) against local PostgreSQL 17.11 on the Mac. CI runs the same commands on 17. Run it yourself:

```sh
npm run db:setup          # both databases + migrations (prisma migrate deploy); the dev DB must be current, or the demo fails on a missing column
npm run seed:demo         # the template's demo accounts (isDemo); once per database, safe to repeat
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npm run commons:demo   # ~45 s; prints acts 1–3, the sign-in line and the org URL
npm run abuse:spam        # ~5 s; act 4, against the test database
npm run dev               # then sign in and open the printed URL (below)
```

`commons:demo` makes a **fresh org per run** (`demo-<yyyymmddHHMM>`). It cannot rebuild one in place: an org that holds moderation-log rows cannot be deleted, because the append-only trigger refuses the cascade too (D-49). The seed is the frozen fixture (500 posts, 5,000 comments, 10,607 vote events; 16,457 rows in all) written **through the real writers** in 42 s.

## Accounts and where the credentials live

| Who | How to sign in | Credential |
|---|---|---|
| `owner@acme.demo.test` (shows as `demo-owner`), owner of each demo org | `http://localhost:7500/demo` → click the address. MFA counts as passed. | None. `/demo` needs `DEMO_MODE=1`, which is already set in `.env.local` (line 5). Unset, `/demo` is a 404 (INV-27). |
| The other five `*.demo.test` accounts | the same page | Owners and admins also hold the public TOTP secret `seed:demo` prints, for the email-link path. |
| `spammer`, `brigader-1`…`7`, `veteran`, `moderator` inside the org | not signed in to | Made by the script as members with a set age and history. Never `isDemo`, so `/demo` cannot sign them in. |

`commons:demo` adds `owner@acme.demo.test` to each new org as its owner. Only `seed:demo` may create `isDemo` accounts (INV-27), so the script reuses that one rather than making its own. Before D-107 the script's only owner was `moderator`, and no demo sign-in reached it.

---

## Act 1 — the same seed under Hot, Top and New

**Where:** `/o/<org>/f/selfhosting`, then the sort tabs.

The board `selfhosting`, ranked at the fixture instant (2026-11-05T00:00:00Z, the same `now` `engine:eval` and the Python oracle use). `rank:recompute` scored 500 posts and 5,000 comments. The page shows `rankedAt` next to the tabs, so a reader can tell a snapshot from a live score.

| Hot (reddit formula, gravity 45,000 s) | Top all time (net) | New |
|---|---|---|
| P-0135 · net 7 · 6 h | **P-GH-50 · net 50** · 168 h | P-0135 · 6 h |
| P-0188 · net 4 · 11 h | P-0206 · net 35 · 868 h | P-0340 · 10 h |
| P-0369 · net 4 · 11 h | P-0119 · net 23 · 185 h | P-0188 · 11 h |
| **P-0340 · net 0 · 10 h** | P-0019 · net 16 · 92 h | P-0369 · 11 h |
| P-0343 · net 14 · 27 h | P-0309 · net 16 · 190 h | P-0316 · 24 h |

**Say:** a post with **net 0 at 10 h outranks net 14 at 27 h under Hot.** 17 hours of age is worth 61,200 / 45,000 = 1.36 on the log scale, more than log10(14) = 1.15. That is the formula doing exactly what `rules/ranking.json` says, not a bug. Whether it is a good ordering for a homelab board is the open question `docs/EVAL.md` refuses to answer. The oracle agrees on every row (`npm run engine:eval`: 15 files, 19,616 rows, 0 differences; `engine:eval:db` the same from stored rows).

## Act 2 — a spam wave through the door

**Where:** the mod queue, `/o/<org>/f/mod`, item `DUPLICATE`.

An account **1 hour old** (young: under 24 h and under 5 contributions) posts 60 comments in 60 s and 5 posts in the hour, every one through `submitComment` / `submitPost`, the only user-facing write path (D-44).

| Attempts | Allowed | Refused `RATE_LIMITED` | First `retryAfter` | Rule |
|---|---|---|---|---|
| 60 comments / 60 s | 2 | 58 | 58 s | `comment` young_max 2 per 60 s |
| 5 posts / 1 h | 1 | 4 | — | `post` young_max 1 per 3,600 s |

**Say:** the two comments that got through had the same body, so the second raised **one `DUPLICATE` signal** (24 h window, ≥ 40 chars, D-45/P1-3). The queue went from one item (the fixture's own brigade on P-BRIGADE, loaded with the seed) to two. Refusals write no rows, so a spammer being refused does not extend their own window (D-45).

## Act 3 — a brigade, one signal, remove, restore, the log

**Where:** the mod queue and P-GW's thread (restored, visible) in the browser; **the log itself in the terminal**. The REVIEW / REMOVE / RESTORE rows are content actions with no member subject, and the only log page is a member's profile (*Moderation log for this member*, warns and bans), so no page lists them.

Seven accounts **2 hours old** each downvote `P-GW` within ten minutes.

- Outcomes: `GATED_DOWNVOTE` × 7. Every vote is **recorded** as an event row (vote rows are truth) and **not counted**: P-GW's `downs` stays 0, `ups` 1 (the author's fixed +1, D-12). The downvote gate is 24 h and 3 contributions.
- ≥ 5 gated downvotes on one node inside 600 s raises **one** `BRIGADE(7 voters)` item (D-31), however many more arrive.
- A 30-day-old member reports the post as `harassment` → `CASE(1 report)`. Queue: `CASE on P-GW, DUPLICATE on spam-1, BRIGADE(7) on P-BRIGADE, BRIGADE(7) on P-GW`, each with author history beside it.
- The owner reviews the signal, removes, then restores: `REMOVE OPEN→REMOVED`, `RESTORE REMOVED→RESTORED`. The transitions come from `rules/moderation.json`; an illegal one is `TRANSITION_INVALID`.
- The log afterwards, oldest first: `REVIEW_SIGNAL`, `REMOVE`, `RESTORE`, each with actor, reason and time. `DELETE FROM "ModerationAction"` is **refused by trigger `commons_append_only`; rows still 3**. The queue after review: the duplicate and the fixture's brigade remain; P-GW's items are gone. That is the page you land on: **2 open items**.

## Act 4 — the link window, and the ways around it that were closed

**Where:** the terminal (`npm run abuse:spam`). There is no page for it; the refusal a spammer sees is the generic rate-limit copy (D-101).

A young account posts 20 links to 20 hosts in a day. The `link` window is 5 a day, 2 for a young account (`rules/limits.json`, D-100). Each later attack tried a way around it and was turned into a fixture before it was fixed (rule 7):

| Script (`abuse:spam`) | Attempts | Allowed | Refused | First `retryAfter` |
|---|---|---|---|---|
| `spam-link-rotation` (one link per post) | 20 | 5 | 15 | 82,500 s |
| `spam-link-syntax-rotation` (the 10 link syntaxes the counter missed, D-103) | 20 | 5 | 15 | 82,500 s |
| `spam-link-edit-in` (link-free posts, links edited in) | 20 | 5 | 15 | 86,100 s |
| `spam-link-edit-swap` (edit one link out, another in) | 20 | 5 | 15 | 82,500 s |

**Say:** before 7.3 the syntax rotation and the edit-in each let all 20 through. The other scripts in the same run show the earlier windows: comments 2 / 58, posts 1 / 19, votes 20 / 80, uploads 2 / 28, a 360-comment thread flood 10 / 350, a 60-deep reply chain stopped at depth 33. The other half of every window is the invented community: 325 link-bearing bodies, **0 refused** (`npm run abuse:normal`; EVAL §Phase 7).

## In the browser

`e2e/commons.spec.ts`: 25 tests on the production build (25/25 locally at 7.1, 2.3 min; CI green on #12, #14 and #15, Playwright included). The same walk through the pages, plus all 48 markdown-class XSS fixture bodies posted through the real comment form. 47 are stored and inert in Chromium (no `script`/`img`/`svg`/`iframe`/`on*`/`javascript:` survives inside a rendered body, no dialog fires). X-37 (a NUL byte inside a script tag) is refused `INPUT_INVALID` at the door. That one was a 500 until the Phase 4 capstone found it (commit `08b65e6`); the failing test was written before the fix, as rule 7 says. axe: 0 violations at 320, 768 and 1280 px, light and dark, on every page type.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `commons:demo` dies on a missing column or table | the dev DB is behind the migrations (it was 3 behind at closure) | `npm run db:setup` |
| The script ends "No demo owner to sign in as" | `seed:demo` never ran on this database | `npm run seed:demo`, then `commons:demo` again (a new org) |
| `/demo` is a 404 | `DEMO_MODE` is not `1` in `.env.local` | set `DEMO_MODE=1`, restart `npm run dev` |
| `org demo-… exists` | two runs in the same minute | wait a minute, or `-- --org demo-b` |
| The page loads with no `demo-owner` link in the header | you signed in as another demo account | sign out, `/demo`, pick `owner@acme.demo.test` |
| Many ~1 s failures, or `too many clients` | another project's sweep holds the Postgres connections or the memory | `psql -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname"`; retry when it ends |
| Port 7500 busy | an earlier `npm run dev` | `lsof -ti :7500 \| xargs kill` |

## Concede before you're asked

- **Nothing here has met a real user or a real attacker.** The attacks are the ones the author scripted; the community is invented, with its rates fixed before any measurement (D-98). Passing both sides proves the rules separate the author's two imaginations.
- **The constants are reddit's historical ones, untuned.** Act 1's net-0-above-net-14 is the formula working as written, and it may be the wrong ordering for this audience.
- **"0 community refusals" depends on the invented community.** A real board with a link-heavy regular would hit the 5-a-day window.
- **None of PRs #4–#15 is merged.** Each phase was tested on its own branch stacked on the last; no merged trunk has run with Phases 5–7.
- **Not deployed, and nothing is sent.** Notices stop in the outbox; there is no Neon project and no Vercel deploy.
- **The content-moderation log has no page.** Act 3's three rows are shown by the script and enforced by the trigger; a moderator in the browser sees only per-member actions on a profile.
- **axe's 0 is the automated subset of WCAG**, not a usability review with assistive-technology users.

## What this demo does not show

It does not show the forum under load, a real community's behaviour, or an attacker who has read `rules/limits.json`. The four acts are the attacks the author scripted; the fixtures are the author's imagination of hostility. See `docs/EVAL.md` §"What these numbers are not".
