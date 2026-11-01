---
reviewed: 2026-10-29
sha: 1167f4e (PR #1 head; merged as 5f0ba21)
mode: read-only review by a po-consolidation agent; nothing was edited or run against production
status: input to docs/phase-4.1-tasks.md and docs/phase-5-tasks.md (D-58..D-63)
---

# Commons — review consolidation (PO pass, 2026-10-29)

Inputs: four reports in scratchpad `reviews/`; repo `/home/claude/commons-app` at the PR #1 head. "verified" = I read the line; "reported" = reviewer claim, not re-read. Nothing edited.

## A. Defects to patch now (not PRDs)

| # | Defect | Source | Violates | Test/fixture first (rule 7) | Size |
|---|---|---|---|---|---|
| A1 | `edit` server action calls `editNode` directly: no `admit`, no `checkText`, no `bodyHash` refresh (`src/app/o/[org]/f/actions.ts:116`, verified; lead-confirmed) | SME | D-44 (one door), D-14, D-53 | `actions.test.ts`: banned editor → `BANNED_UNTIL`; NUL in edit body → `INPUT_INVALID`; e2e X-37 through the edit form | S/M |
| A2 | `submitReport` never calls `admit` (`src/forum/moderation.ts:46-58`, verified) | SME | D-14 lists reports | `moderation.test.ts`: banned reporter refused | S |
| A3 | `BRIGADE_MIN=5`, `BRIGADE_WINDOW_S=600` hard-coded (`src/forum/votes.ts:13-14`, verified) | SME | Non-negotiable 6, D-31 | rules-loader test + zod schema for `limits.brigade`; `P-BRIGADE` still yields exactly 1 signal; `engine:lint` validates | S |
| A4 | `BANNED_UNTIL` copy drops the lift time though `e.message` carries the epoch (`f/actions.ts:31` vs `forum/actions.ts:31`, verified) | UX | D-14; task 4.2 acceptance | `actions.test.ts` asserts formatted time in message | S |
| A5 | Hot score printed to every reader: `hot {t.postScore.hot.toFixed(2)}` (`p/[post]/page.tsx:167`, verified) | UX, design | D-9 ("shown only in the eval") | e2e: member view contains no `hot ` token | S |
| A6 | Upload refusal rendered as `role="alert"` inside a closed `<details>` (`page.tsx:181,208`, verified) | a11y | P0-4 "limit responses are honest"; WCAG 4.1.3 | e2e: SVG refusal visible without a click | S |
| A7 | `vote`/`edit`/`moderateContent` redirect to the thread root with no `#anchor` (`f/actions.ts:108,122,170`, verified) | UX, a11y | P0-2 toggle/switch semantics unobservable; WCAG 2.4.3 | e2e: URL fragment = node publicId after edit/moderate; vote returns `{notice}` (see E2) | S |
| A8 | `authorHistory` counts reports on POSTs only (`mod/page.tsx:38`, verified) | UX | P0-5 "author's history" | moderation view test: comment spammer shows N>0 | S |
| A9 | `EditHistory` written, never read by any page (grep `src/app`: 0 reads, verified) | UX | P0-6 "visible to mods" | view test: mod sees previous bodies, member does not | S/M |
| A10 | No action produces status `deleted` (verified: only the type union mentions it) | UX, SME | D-13, P0-1 fixture "author-delete vs mod-remove" | `forum.test.ts`: author delete → `[deleted]`, subtree kept, votes kept | S |
| A11 | `canModerate` ignores `bannedUntil`/`modState` (`moderation.ts:10`, verified); and `isModerator` has no setter anywhere in `src/app` (verified) though D-48 says owner/admin flip it on the profile page | SME | D-14 spirit; D-48 | `moderation.test.ts`: banned mod refused; GRANT_MOD/REVOKE_MOD as logged `ModerationAction` kinds | S |
| A12 | Refused compose/reply wipes the body (React 19 resets `<form action>` fields on settle; `src/core/ui/action-form.tsx:14`, template-owned) | UX | P0-4 "not silent drops" | e2e: `RATE_LIMITED` reply keeps the typed body | M (clone wrapper in `src/components/`; upstream note) |
| A13 | CSS/markup batch: vote buttons ≈22×19 px (`commons.css:19`), `input size={60}` breaks 320 px (`[board]/page.tsx:60`), `line-height:1.45`, no table wrapper, no skip link, `ago()` minutes-only (`forum.tsx:16`), no `<time>`; `generateMetadata` only on 2 of 7 pages (verified) | a11y, UX, design | WCAG 2.5.8, 1.4.10, 2.4.2; "say what the numbers mean" | axe run at 320 px + after an action added to the e2e capstone; title assertion per page | S |
| A14 | Report "Something else (say what)" has no `detail` field though the schema accepts it (`f/actions.ts:125`, verified; render: reported); duplicate-report surfaces as `INPUT_INVALID: Check the form…` (`moderation.ts:53`, verified) | UX | P0-5 | e2e: `other` + detail reaches the queue; own code `ALREADY_REPORTED` | S |

Not defects (decision changes, see D4): user `h1`–`h6` in bodies and `target="_blank"` — both are explicitly D-43.

## B. Candidate PRDs (ranked)

1. **Vote control: state + outcome + placement** (UX, a11y, design). Problem: a member cannot tell applied from toggled-off, and voting needs a disclosure click. Scope: `myVote` map in `thread()`/`boardPosts()`, `aria-pressed`, buttons outside `<details>`, ≥24 px targets, author sees fixed "+1 (yours)", `vote` returns `{notice}` for `APPLIED|SWITCHED|TOGGLED_OFF`. Must not: add client JS beyond server actions; change D-12/D-29. Size M. Deps: A7. **Do** — closes P0-2's visible half.
2. **Vote-ring and aged-brigade signals as data** (SME #1, #2). Problem: only gated downvotes are examined (`votes.ts:33`, verified); 10 fresh upvotes buy 12.5 h of Hot. Scope: `rules/limits.json` `signals.ring {min, window_s, max_account_age_h}` and `signals.aged_brigade`; detector in the vote path; queue items; fixtures `P-RING`, `P-BRIGADE-AGED` + `expected_signals.csv`. Must not: block or reverse votes (D-31: signal, never act); no classifier. Size M. Deps: A3. **Do** — same pattern as D-31, extends learning artifact #3.
3. **Ranking measurement study** (SME §2; measurement-first, not tuning). Problem: with median net 4, Hot may order ≈ New; Best on n≤3 is mostly D-9 tiebreak. I counted the fixture: 1,941/5,000 comments have zero non-author votes, 3,912 have ≤2 (SME said 1,945/3,919; direction right). Scope: a `tools/` stdlib script reporting (a) Hot↔New rank correlation per board at 6-h steps, (b) time-in-top-5 Hot vs New, (c) share of sibling groups with all n≤2, (d) contributions at first downvote; proposed golden cases GH-08 (gravity 90000 crossover), GW-09 (Best without author +1). Must not: change `ranking.json` or regenerate expected files; any later change needs a D- entry, a golden case, **and** an explicit rule-8 exception since `expected_post_order_hot.csv` would be regenerated (D-27 showed gravity 90000 turns it red). Size M. **Do** the study; tuning is a separate owner decision.
4. **Mod queue triage v2** (UX, design, SME §3). Problem: 50 full bodies per page, no filters, no inline ban/lock, no reporter history. Scope: compact rows + 240-char excerpt disclosure, `?kind=`/`?reason=` filters, inline `moderateUser`/lock per case, reporter handles + detail + per-reporter cleared/removed ratio, log paging + `seq` + linked targets, lock refuses `vote`/`edit` too, `REPORT_SWARM` signal as data. Must not: auto-action; add roles (template-owned). Size L. Deps: A8, A9, A11, A14. **Do**, split in two PRs.
5. **Thread and board readability + native design tokens** (design §1-2, UX #7-8-12, a11y M1-M5). Scope: board page `take 25` + pager, 2-column row, relative age with `<time datetime>`, `Badge` text labels (pinned/locked/removed/edited), per-comment `<h3>` + "M replies", `<details>` collapse per subtree, breadcrumb `<nav>`, ScopeNote once in a footer, "Delete org" out of forum nav, honest empty states, 5-role CSS custom properties via `color-mix` (no dependency). Must not: add a CSS framework or client JS; drop the scope sentence. Size M. **Do**, after 1–4.
6. **Upload hardening + author alt text** (a11y S5, SME #10). Scope: `alt` column + required field (or explicit decorative), `upload` window and `max_per_post` in rules, dimension cap by header parse (PNG IHDR / JPEG SOF / WebP VP8X, stdlib-free), 404 for uploads of removed posts. Must not: add an image library (EXIF strip deferred; ask first). Size M. **Do**.
7. **Edit integrity** (SME #3). Scope: `edit` window in `rules/limits.json`, `EDITED_AFTER_VOTES` signal (`net ≥ k` outside window) as data, rehash on edit. **Defer** until B3 measures how often top posts are edited late; A1/A9 cover the real holes.
8. **Account lifecycle: erasure + ban-evasion signal** (SME #7, #14). Scope: erasure = body overwrite + `EditHistory` body redaction (log rows stay), "joined < 24 h after a ban" list. **Defer** — synthetic data, no deploy; write the runbook as a doc only.

## C. Declined / deferred

- Board descriptions (UX, design, SME): defer to B5 as optional migration; low cost, but a schema change deserves its own line.
- Search GIN index + `search` window (SME #11): defer; D-52 named the seam, 500 posts.
- Reply-chain flood scope `profile+post`, `max_depth_written`, link-host extraction, repost title-hash, pin cap: defer; measure in `abuse:*` first; rules-as-data when done.
- Appeals, two-person rule, per-board moderators, case notes/claiming, transparency log: defer to P2 — state additions are data, but scope at hundreds of users.
- Homelab features (structured builds, wiki pins, flair, "solved", cross-posts): decline for this build — outside PRD; note as seams.
- Digests/subscriptions to outbox: decline (non-goal; nothing is sent).
- Density toggle, identity tiles: decline (cookie state, no value yet).
- EXIF strip: defer (needs a decoder; ask-before-add).
- Keyboard-shortcuts policy, reduced-motion guard: accept as one decisions line + one CSS rule inside A13.

## D. Decisions for Shane

**D1. Where the patch lands.** (a) more commits on PR #1's branch; (b) merge PR #1, then `phase-4.1` → PR #2 with A1–A14; (c) fold into Phase 5. **Rec (b):** PR #1 is the Phases 1–4 record with green CI; a 14-item patch reads better as its own diff. Downstream: CLOSEOUT unchanged; NEXT.md gets a 4.1 section; D-58+ entries.

**D2. Phase 5 contents.** (a) B1+B2+B4 (integrity + moderation) with B3 running as a `tools/` script; (b) B1+B5 (UI pass); (c) B3 only. **Rec (a)** — stays on the adversarial thesis; B5/B6 become Phase 6.

**D3. Commit the four reports.** (a) verbatim to `docs/reviews/` with a header (date, SHA, read-only) plus this consolidation; (b) summary only; (c) no. **Rec (a):** the SME table extends "attacks the author thought of", which belongs in the repo; WRITEUP's attack table gains its rows.

**D4. Amend D-43.** (a) demote user headings by 3 levels (h1→h4) and drop `target="_blank"`; (b) headings only; (c) keep. **Rec (a):** markdown-it renderer rule, no dependency; render fixture rows added first (definition fix per D-41 precedent, not a D-10 edit).

**D5. Design tokens.** Native CSS custom properties + `color-mix` on system colours; **no dependency, not on the ask-before-add list.** (a) land in B5; (b) land `--danger`/`--ok` now for alerts; (c) decline. **Rec (a).**

**D6. Ranking constants.** (a) measure only (B3); (b) change gravity now. **Rec (a):** a change regenerates a frozen expected file (rule 8) — only you can authorise that, with numbers in hand.

## E. Where reviewers disagree or are wrong

1. **GATED_DOWNVOTE copy.** UX #4 calls "Recorded, not counted" confusing; SME §5 calls recording-not-dropping the design's best feature. Both right at different layers: keep the `VoteEvent` mechanism, rewrite the copy effect-first ("Your downvote wasn't counted: accounts need 24 h and 3 contributions"). Patch A14.
2. **Vote after-action: redirect vs notice.** UX #2 wants `redirect(...#anchor)`; a11y S1 wants `return {notice}` + `revalidatePath`. A redirect re-renders `<details>` closed and cannot carry `aria-pressed` state; the notice path keeps the panel open and announces the outcome. Call: notice for `vote`, anchored redirect for `edit`/`moderate` (A7, B1).
3. **"Edit bait-and-switch after 900 s" framed as an attack.** P0-6 and D-32 designed exactly that: late edits are marked and history is kept for mods. The genuine holes are the door bypass (A1) and that no page reads `EditHistory` (A9, verified). The proposed `EDITED_AFTER_VOTES` threshold `k` is untested guesswork — defer (B7) until B3 measures it. Also minor: SME's fixture counts (1,945 / 3,919) are off by 4–7 from my count (1,941 / 3,912); conclusion unchanged.

Memory used: none beyond Shane's stated preference for recommendation-first, one-decision-at-a-time framing (from `/preferences`).