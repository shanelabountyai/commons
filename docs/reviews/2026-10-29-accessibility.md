---
reviewed: 2026-10-29
sha: 1167f4e (PR #1 head; merged as 5f0ba21)
mode: read-only review by a accessibility agent; nothing was edited or run against production
status: input to docs/phase-4.1-tasks.md and docs/phase-5-tasks.md (D-58..D-63)
---

# Commons accessibility review (WCAG 2.2 AA) — read-only, 2026-10-29

Scope: `src/app/o/[org]/**`, `src/components/forum.tsx`, `src/render/*`, `src/app/commons.css`, `src/core/ui/action-form.tsx`, `src/app/o/[org]/f/actions.ts`, `src/votes`, `src/forum/view.ts`. Static review; nothing run in a browser.

## 1. Findings

### Serious

**S1. Vote buttons are toggles with no state and no outcome (4.1.2, 3.2.2).** `p/[post]/page.tsx:81-82,186-187`: `▲`/`▼` have `aria-label` but no `aria-pressed`; `view.ts` never loads the viewer's `Vote` row (no `myVote` anywhere). `src/votes` returns `APPLIED | SWITCHED | TOGGLED_OFF`, so pressing ▲ a second time silently removes the vote; `actions.ts:108` redirects on success, so nothing is announced and focus lands at the top of the document (see S2). A screen-reader user cannot tell applied from toggled-off. Only `GATED_DOWNVOTE`/`SELF_VOTE` return a `{notice}`. Fix: in `thread()` fetch `db.vote.findMany({ where: { voterId: me.profileId, postId } })`, pass `myVote` per node, set `aria-pressed={myVote === 1}` / `=== -1`; in `vote` return `{ notice: 'Upvote applied (APPLIED)' }` etc. for all outcomes instead of `redirect` (`revalidatePath` already refreshes counts in the same response), which also keeps the `<details>` open.

**S2. Focus is thrown away after vote/edit/moderate (2.4.3, 3.2.2).** Every successful action in `actions.ts` ends in `redirect()` to the thread root (`:108,122,170`); the per-comment `<details>` re-renders closed. A keyboard user who voted on comment 150 of 200 restarts at the nav. `reply` is the exception (`#${publicId}` fragment sets the focus start point). Fix: redirect to `${here}#${node.publicId}` for comment actions, or return a notice (S1); add `tabIndex={-1}` to `li.c` so the fragment target is programmatically focusable.

**S3. Upload refusal is rendered inside a closed `<details>` (3.3.1, 4.1.3).** `p/[post]/page.tsx:181,208`: `?upload=<msg>` renders `<p role="alert">` inside the attach form inside the collapsed panel. `role="alert"` present at page load is not announced, and it is not visible. Fix: `<details open={!!sp.upload}>` and move the message above the summary (or beside `<h1>`), and add `aria-describedby` from the file input to it.

**S4. User headings hijack the page outline (1.3.1, 2.4.6).** `render/index.ts:246` allows `h1–h6` in bodies; `markdown-it` emits `<h1>` for `# text`. A comment can inject h1s between the page `<h1>` and "N comments", and spam can seed heading navigation. Fix (needs a D-43 entry + XSS/render fixture, rule 6/7): add a `heading_open`/`heading_close` renderer rule that clamps to `h4–h6` (`level = Math.min(6, level + 3)`), or drop headings to `<p><strong>`.

**S5. Uploaded images have no author alt (1.1.1).** `p/[post]/page.tsx:176`: `alt="Attachment 1a2b3c4d (image/png, 312 kB)"`; the attach form (`:202-209`) has no text field. Fix: add `<label>Describe the image <input name="alt" required maxLength={300} /></label>`, column `Upload.alt`, render via `renderText`; allow empty alt only with an explicit "decorative" checkbox.

**S6. Vote target size (2.5.8).** `commons.css:193` `.votes button { padding: 0 0.4rem }`; default button font is 13.33px, so each is ≈22×19 px, and ▲▼ are adjacent with no gap (JSX lines 81-82 emit no whitespace), so the spacing exception does not apply. Fix: `.votes button { min-width: 24px; min-height: 24px; margin-right: 4px }`.

**S7. Reflow at 320 px (1.4.10).** `[board]/page.tsx:60` `<input size={60}>` and `search/page.tsx:19` `size={40}` are fixed ≈500/340 px wide and force horizontal scroll. Fix: `input[type=text], input:not([type]) { max-width: 100%; box-sizing: border-box }`. Also note depth-6 comments keep ~96 px of text column (6 × 32 px indent); consider `ol.thread ol { margin-left: 0.5rem }` under `@media (max-width: 30rem)`.

**S8. Page titles (2.4.2).** Only `f/page.tsx`, `search`, settings export `metadata`; board, thread, permalink, profile and mod queue are all titled "Commons". Fix: `generateMetadata` returning `{ title: post.title }` / board title / `@handle` / "Moderation queue" (Next escapes).

### Moderate

**M1. Permalink page flattens the tree (1.3.1).** `c/[comment]/page.tsx:37-53` uses one `<ol>` with `style={{ marginLeft }}`; nesting exists only visually plus the text "depth N". The thread page's `Tree` already nests `<ol>`s — reuse it.

**M2. Removed placeholders name the author "removed" (1.3.1).** `aria-label={`Comment by ${removed ? 'removed' : n.author}`}` (`:63`) reads "Comment by removed". Use `Deleted comment` / `Removed comment (by moderator)` and put the status in visible text, not only `[deleted]` in italics at 0.8 opacity.

**M3. Pinned/locked carried by CSS emoji (1.1.1, 1.3.1).** `commons.css:201-202` `.pin::before { content: '📌 ' }`; announced as "pushpin" or not at all. Board page shows "locked" as text but "pinned" only via emoji (`[board]/page.tsx:46`). Fix: render `<span className="meta">Pinned</span>` text; keep the emoji as `content: '📌 ' / ''` alternative text syntax.

**M4. Errors not associated with fields, no focus move (3.3.1, 3.3.3).** `action-form.tsx:19` injects `<p role="alert">` at the top of the form; no `aria-invalid`, `aria-describedby`, or focus. Template-owned: file an upstream request (persistent `aria-live="assertive"` container, `ref` focus on error). Also `fieldset disabled={pending}` drops focus from the submit button during the request; on return focus is on `<body>`.

**M5. Repeated identical link text (2.4.4).** "permalink" and "Continue this thread →" appear per comment with no distinguishing text (`:66,71`). The `<article aria-label>` gives context, but links lists are useless. Fix: `aria-label={`Permalink to comment by ${n.author}`}` and "Continue thread under {author}'s comment"; drop the literal arrow (read as "right arrow").

**M6. Forced `target="_blank"` on user links (3.2.5 advisory, cognitive).** `render/index.ts:279`. New windows with no warning; `rel` policy does not need it. Propose a D-43 amendment to drop it.

### Minor

- Breadcrumbs are `<p class="meta">` (`[board]:25`, `p/[post]:158`) — make `<nav aria-label="Breadcrumb"><ol>`.
- Tables lack `<caption>` (`mod/page.tsx:98`, `u/[handle]:76`); "From → to" cells read "visible right arrow removed" — use `<caption>` and "from visible to removed".
- Pagination links are bare numbers (`p/[post]:255`); add `aria-label="Page N"` and prev/next.
- Times: `when()` gives "2026-10-29 00:00 UTC" with no `<time dateTime>`; `ago()` can print "1440 min ago". Wrap in `<time>`, humanise > 60 min.
- `ScopeNote` is a complementary landmark on every page; cognitive noise. Keep on Boards, shorten elsewhere.
- Contrast/focus/motion: system colours, `opacity: .85/.8` on CanvasText stays > 7:1; no custom focus styles (browser ring, nothing obscures it: pass); no transitions/animations (2.3.3 trivially pass).

## 2. Missed / should add

- **Skip link** (S): nav has 7–8 links before `<main>` on every page. Add in `o/[org]/layout.tsx` `<a href="#main" className="skip">Skip to content</a>`, `id="main" tabIndex={-1}` on each `<main>`, one CSS rule to show on focus.
- **Vote state + outcome notices** (M): S1/S2 together.
- **Headings per comment** (S): `<h3 className="meta">` with author inside each `<article>` so heading navigation works in 200-comment threads.
- **Per-comment depth/count cue** (S): "depth N · M replies" in the meta line on the thread page (the permalink page already prints depth).
- **Keyboard shortcuts policy** (S, doc): none exist; record "no single-key shortcuts (2.1.4 by construction)" in decisions.md so nobody adds `j/k` later.
- **Reduced motion** (S): add `@media (prefers-reduced-motion: reduce) { * { transition: none } }` as a guard; nothing animates today.
- **Text/spacing preference** (M): system fonts and `rem` already respect browser zoom; a 1.4.12 check (line-height 1.5, paragraph 2em) is the only gap — `line-height: 1.45` should be ≥ 1.5.
- **Upload alt field** (M): S5.

## 3. What axe's 0 proves

axe ran on 10 server-rendered loads in both colour schemes and confirms the markup has labels, roles, lang, contrast on system colours, and no nesting errors — the ~30% of WCAG that is machine-checkable. It cannot see that a vote toggles without state, that focus is lost on every redirect, that an alert sits inside a closed `<details>`, that user headings break the outline, that an `alt` is meaningless, or that 320 px reflow fails; none of the 10 loads was taken after an action, at 320 px, or at 200% zoom. Treat it as a regression floor, not a conformance claim.