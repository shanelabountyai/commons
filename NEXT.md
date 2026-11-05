# NEXT

## ▶ PRD 7.2 built on `phase-7.2` (D-101, 2026-11-04). PR: https://github.com/shanelabountyai/commons/pull/14 (base `phase-7.1`), CI pending. The link window `{link, 86400, 5, young 2}` is live at the post and comment door; the other three hypotheses are recorded with numbers (EVAL §Phase 7 — 7.2). Oracle reproduced every draft number: attack 5 allowed / 15 refused (retry 82,500), community 325 / 0 refused. **Two findings for Shane, not built (rule 7: fixture first):** (1) autolinks `<https://host>` render as clickable links but are not counted, so the attack bypasses the window with that syntax; (2) edits have no window (D-32), so links can be edited in within 900 s. Three deviations from the PRD text are in D-101 (refusal copy is the generic one, since the number is data; the record-only lines come from `tools/carried_measures.py`; title-hash window not computed separately). Next session item: **Shane's call on the two findings** (each would be a small PRD 7.3, fixture first), or the Phase 7 gate. Model: Opus 5.5 (D-74). Still for Shane: merge #4 → … → #12 → this PR, each into its base.

**Gate (local):** vitest 404/404 (52 files); `engine:eval` 15 files / 19,613 rows / 0 differences; `engine:eval:db` OK; `abuse:spam` 7/7, `abuse:normal` 6/6; golden 68 OK; `fixtures:check` OK; `engine:lint` OK (7 windows); `xss:check` 61/61; `foundation:drift` clean; eslint, tsc clean. Not run locally: Playwright (CI decides; no UI file changed) and `migrate diff` (no `prisma/` file changed; CI runs it).

---

## ▶ PRD 7.2 drafted on `phase-7.2` off `phase-7.1` (D-99) and **approved as drafted** (D-100, 2026-11-04): link window 5 / 24 h, young 2; `min_contribution_chars` record only; repost record only, window stays 86,400; link history from body rows. Still for Shane: merge #4 → … → #12, each into its base. Next session item: **build 7.2**, oracle and the two `expected_limits.csv` rows first, then red tests, `linkHosts` + rule, the door in `submitPost`/`submitComment`, all three script copies in one commit (run `engine:eval:db` before the push), EVAL §7.2; PR against `phase-7.1`. Model: Opus 5.5 (D-74).

**Draft-time numbers (stdlib read, oracle to reproduce):** link window binds (attack 20 → 5; community 0 of 325 refused, peak 2 a day, young 2); `min_contribution_chars` 40 refuses 6 community downvotes, only 2 refuses 0; report swarm 0 of 151 organic reports, but only 2 are young and the any-age peak (4) sits on the threshold; repost can't be separated (attack 25 h, organic 12–69 h; 3 d+ flags all 10). Doc work only: no gate run, and no PR for a draft (same as 6.x and 7.1).

---

## ▶ PRD 7.1 built on `phase-7.1` (D-98, 2026-11-04). PR: https://github.com/shanelabountyai/commons/pull/12 (base `phase-6.4`), **CI green** (https://github.com/shanelabountyai/commons/actions/runs/41913188733: ci and modules-removed pass). Shane approved all four PRD recommendations (additive; rates as drafted; loader uses bodies; no pins). Next session item: **draft PRD 7.2** (the four carried measurements through the 6.4 bind test, `docs/phase-7-tasks.md` row 7.2) for review; nothing built; stop at the draft. Model: Opus 5.5 (D-74). Still for Shane: merge #4 → … → #12, each into its base.

**Built:** `fixtures/community/` from seed 20261104: `bodies.csv` 5,500 rows (400 short comments; links on 75 posts and 250 comments, 12 `.example` hosts), `reports.csv` 151 (55 + 96 on the 43 removed nodes), `reposts.csv` 10 pairs (the third file the PRD left unnamed). `tools/community_text_lib.py` oracle; `verify_fixtures.py` reproduces all three and checks the reposts are the only duplicates. `loadForum` writes the text and `bodyHash`. MANIFEST +3; the 22 frozen files byte-identical.
- **Gate (local, Mac):** `tests/engine/community-text.test.ts` 7/7 (red first); vitest 397/397 (3 failed under load average 30, Prisma transaction start timeout and harness 180 s, then 21/21 alone); `engine:eval` 15 files / 19,611 rows / 0 differences; `engine:eval:db` OK; `fixtures:check` OK (26 files); golden 64; `xss:check` 61/61; `engine:lint`, `foundation:drift`, eslint, tsc clean; Playwright 25/25 on the production build (2.3 min).
- **Found:** the e2e spec matched posts by the placeholder `"<id> title"` (19 lines) and by an id inside a title (2 lines, the first sweep's one failure). It now looks titles up from `bodies.csv`, and the three search URLs query `firewall`. **For 7.2:** the live 24 h duplicate signal catches 2 of the 10 reposts (gaps 12–69 h); that number belongs to 7.2.
- **Tooling note:** under `--reporter=line`, Playwright's inline failure line is `  1) e2e/…`, not `[chromium]`. The first alarm grep missed it.

---

## ▶ PRD 7.1 drafted on `phase-7.1` off `phase-6.4` (D-97, 2026-11-04); **stopped for review.** Shane confirmed D-88, D-91 and D-95 as built, and chose to regenerate the fixture before closing (D-96). Next for Shane: answer the PRD's four decisions (additive or rewrite; the pre-registered rates; whether the loader uses the bodies; pins), and still merge #4 → … → #11. Next session item: **build 7.1** once approved, generator and oracle first. Model: Opus 5.5 (D-74).

**Found while drafting:** `body_hash` in the community fixture is `sha256(id)`, not a hash of any text, so real bodies can't match it. The PRD keeps the 22 frozen files byte-identical and adds `fixtures/community/` from seed 20261104. The rates are fixed before any measurement, because the normal side is invented. Doc work only: no gate run, and no PR for a draft (same as 6.1–6.4).

---

## ▶ Phase 6 gate passed on `phase-6.4` at `40edfb7` (D-95, 2026-11-04); **stopped for review.** Nothing after Phase 6 is queued. Next for Shane: (1) merge #5 → #6 → #7 → #8 → #9 → #10 → #11, each into its base; (2) confirm or reverse D-88's three calls, D-91's two, and D-95's fix; (3) the carried fixture-regeneration decision (unlocks `min_contribution_chars`, the community-report check, link hosts, repost and pins together); (4) close the project or name Phase 7. On closure: the four deliverables (`docs/DEMO.md` run once, the exec brief, Ledger posts, cost review). Model: Opus 5.5 (D-74).

**Gate:** vitest 390/390; `engine:eval` 15 files / 19,611 rows / 0 differences; `fixtures:check`, golden 64, `xss:check` 61/61, `engine:lint`, drift, `repo:ignored`, tsc, eslint clean; `src/render` and `src/tree` untouched since `phase-5.4b`.
- **Found by the gate:** "every page at three widths" was wider than the 6.x specs. A new e2e test measures search, a profile and the mod queue at 320/768/1280, light and dark. It was red on the profile at 320 px (`scrollable-region-focusable`: the moderation-log table scrolls and could not be focused). Both forum tables now take `tabIndex={0}` + a name; scoped run 1/1, axe 0 on 18 measurements.
- **CI:** run 41743879806 is green on the 6.4 code head; run 41886576485 is **green** on `3fc8e76` with the gate commits (ci and modules-removed pass): https://github.com/shanelabountyai/commons/actions/runs/41886576485
- **Not re-run locally:** the full Playwright sweep, `engine:eval:db`, `abuse:*` (run at 6.4 on the same code; CI owns the sweep). 6.2 has no `docs/EVAL.md` section; its numbers are in D-88.
- **Tooling note:** a Monitor whose command contains `pkill -f "$PWD.*playwright"` matches its own command line and kills itself; the run continues silently. Do the pkill in a separate Bash call first.

---
## ▶ PRD 6.4 built on `phase-6.4` (D-94, 2026-11-03). PR: https://github.com/shanelabountyai/commons/pull/11 (base `phase-6.3`), **CI green** (https://github.com/shanelabountyai/commons/actions/runs/41743879806: ci and modules-removed pass). Next session item: **the Phase 6 gate**: every 6.x row is ✅, so re-run the gate on the 6.4 head, write `docs/EVAL.md` §Phase 6 — gate, and stop for review (the closure prompts follow when Shane closes the project). Model: Opus 5.5 (D-74). Still for Shane: merge #5 → … → #10 → this PR, each into its base; confirm or reverse D-88's three calls and D-91's two; the carried fixture-regeneration decision now unlocks link hosts, repost and `min_contribution_chars` together.

**Built, oracle first:** four `expected_limits.csv` rows (seven byte-identical); a `profile+post` comment window (10/h, young 3) from the member's `Comment` rows and `max_depth_written` 32 at the door; the three script copies (`src/eval` `commentLimitRows` shared by `engine:eval` and `engine:eval:db`; `abuse.ts` through the live door). Bind results: flood 360 → 10 allowed, community 0 of 5,000 refused; chain 60 → 33 allowed, community 0 refused. Link hosts, repost and pins are recorded as not measurable (EVAL §6.4).
- **Depth decision (Shane, this session):** 32 stays on T-2 (top level 0), so 33 levels; the PRD's draft numbers counted from 1 (D-94).
- **Gate (local, Mac):** vitest 390/390; `engine:eval` 15 files / 19,611 rows / 0 differences; `engine:eval:db` OK; `abuse:spam`/`abuse:normal` OK; golden 64; `fixtures:check`, `xss:check` 61/61, `engine:lint`, drift, `migrate diff`, eslint, tsc clean; Playwright 24/24 locally. The first CI run (41742767473) failed: the e2e XSS walk's 11th comment on one thread hit the new window. The spec now ages its comments out of the hour, as it already cleared `LimitHit`.
- **Environment, not code:** other projects' sweeps (rental business with 39 PG connections; alongside) held the load average at 50–75. The first `engine:eval:db` died in the unchanged `loadForum` on Prisma's 900 s transaction timeout; on a quiet machine it took 40 s. `abuse:normal` took 9 min under that load. One INV-09 case failed right after I killed a sweep (its workers were still writing); alone it passed twice, and the full rerun passed.

---

## ▶ PRD 6.4 drafted (D-92) and approved as drafted (D-93, 2026-11-03) on `phase-6.4`, off `phase-6.3`. Nothing built, no gate run (doc work only); no PR opened for a draft (same as 6.1, 6.2, 6.3). Next session item: **build 6.4**, oracle first: `tools/limitslib.py` scoped check, `tools/reference_rank.py --write-expected` adds `spam-flood-thread`, `normal-community-thread`, `spam-deep-chain`, `normal-community-depth` (seven existing rows byte-identical), the same rows in `scripts/abuse.ts` and `scripts/engine-eval-db.ts`, then red unit and integration tests, then rules, engine, door, the three attack-only measures and `docs/EVAL.md` §6.4. Model: Opus 5.5 (D-74). Still for Shane: merge #5 → … → #10, each into its base; confirm or reverse D-88's three calls and D-91's two.

**Found while drafting:** only two of the five §C hypotheses can be measured on both sides. The community fixture has no bodies (link hosts), writes unique titles and bodies by construction (repost: any window refuses 0, vacuously) and holds no pins. The fixture-regeneration owner decision now unlocks five things, not two.

---

## ▶ PRD 6.3 built on `phase-6.3` (D-91, 2026-11-03). PR: https://github.com/shanelabountyai/commons/pull/10 (base `phase-6.2`), **CI green** (https://github.com/shanelabountyai/commons/actions/runs/41731816550: ci and modules-removed pass). Next session item: **draft PRD 6.4** (§C measurements, `docs/phase-6-tasks.md` row 6.4) for review; nothing built; stop at the draft. Model: Opus 5.5 (D-74). Still for Shane: merge #5 → #6 → #7 → #8 → #9 → #10, each into its base; confirm or reverse D-88's three calls and D-91's two.

**Gate (local, Mac):** vitest 382/382 (51 files; boards 8/8 red first); harness covers `describeBoard` with 0 findings; Playwright 24/24 on the production build (2.8 min; 6.3 red first), axe 0 at 320/768/1280 light and dark; `xss:check` 61/61; `engine:eval` 15 files / 19,607 rows / 0 differences; `fixtures:check` OK; `engine:lint`, `foundation:drift`, `migrate diff` (empty, needs `SHADOW_DATABASE_URL` → `commons_shadow`), eslint and tsc are clean.

**Environment, not code:** one harness run hit its 180 s timeout while the load average was 75 (Spotlight indexing). A per-action timing run took 315 s for 36 actions, and every action had 0 findings. The full `npm test` passed once the load fell to 15. The test DB has migration `20261103180000`. Run `npm run db:migrate` on the dev DB, and reload it to get the descriptions and titles, before `npm run dev` or a demo.

---

## ▶ PRD 6.3 approved (D-90, 2026-11-03) on `phase-6.3`, off `phase-6.2`. Next session item: **build 6.3** on `phase-6.3`, red first: `tests/integration/boards.test.ts` (owner/admin set, member and moderator refused, 301 chars / newline / NUL refused, blank clears, loader writes six descriptions and the `boards.csv` titles) and the e2e (description on Boards and board page, edit visible only to owner, `<img onerror>` as text, axe 0 at 320/768/1280 light and dark), then migration `Board.description`, the shared control-character helper, `describeBoard`, the render sites; move the e2e locators from slugs to titles. Open a PR against `phase-6.2` at the end. Model: Opus 5.5 (D-74). Still for Shane: merge #5 → #6 → #7 → #8 → #9, each into its base, and confirm or reverse D-88's three calls.

**Found while drafting (D-89):** `loadForum` created every board with `title: slug`; `fixtures/boards.csv`'s titles were never read. D-90 (2) fixes it in the build.

---

## ▶ PRD 6.2 built on `phase-6.2` (D-88, 2026-11-03). PR: https://github.com/shanelabountyai/commons/pull/9 (base `phase-6.1b`), **CI green** at the `engine:eval:db` fix (https://github.com/shanelabountyai/commons/actions/runs/41705794019: ci and modules-removed pass; vitest 374/374, Playwright 23/23). The first CI run failed: `engine:eval:db` keeps a third copy of the limit scripts and was missing the upload row. Next session item: **draft PRD 6.3** (board descriptions, `docs/phase-6-tasks.md` row 6.3) for review; nothing built; stop at the draft. Model: Opus 5.5 (D-74). Still for Shane: merge #5 → #6 → #7 → #8 → #9, each into its base, and confirm or reverse D-88's three calls (the migration also widens `LimitHit_action_check`; the JPEG strip drops every APP1 and keeps APP13; legacy `alt = null` rows get no edit flow).

**Gate (local, Mac):**
- vitest 374/374; uploads integration 10/10 (9 red first; D-86's ban and lock gaps reproduced).
- `engine:eval` 15 files, 19 607 rows, 0 differences (uploads/cases.json 30/30); `fixtures:check` OK; golden 60 OK; `engine:lint` OK (7 files).
- `abuse:spam` `spam-young-uploads` 2/28/3580 = the row; `abuse:normal` OK.
- `xss:check` 61/61, `src/render` untouched; `foundation:drift` clean.
- e2e 4.1.6 + 6.2 red first, then green; axe 0 at 320/768/1280, light and dark.
- CI run 41705794019 is green (the full sweep and the harness ran in CI).

The test DB has migration `20261103120000`. Run `npm run db:migrate` on the dev DB before `npm run dev`/demo.

---

## ▶ PRD 6.2 approved (D-87, 2026-11-03) on `phase-6.2`, off `phase-6.1b`. Next session item: **build 6.2** on `phase-6.2`, fixture first: `tools/uploadlib.py` + `tools/build_upload_fixtures.py --seed 20261103` → `fixtures/uploads/cases.json` (header and dimension cases, plus the EXIF/XMP strip cases), then the `spam-young-uploads` row in `expected_limits.csv` (the six existing rows byte-identical), GL-15..GL-22, then red integration tests (ban, lock, per-post, window, pixels, 404, alt) before any product code. Open a PR against `phase-6.1b` at the end. Model: Opus 5.5 (D-74). Still for Shane: merge #5 → #6 → #7 → #8, each into its base.

**Mac session (2026-11-03, Opus 5.5, Shane's "go").** Read the upload path end to end for the draft. **Found:** `POST /f/uploads` skips `admit` (a banned member can attach; a locked thread still takes attachments), the route would 500 on a `RateLimited`, and the thread lists a removed post's attachments to every member. All are recorded in D-86 and become red tests first. a11y S3 was already closed by 4.1.6; only `aria-describedby` is left. No PR opened for a draft (same as 6.1).

---

## ▶ PRD 6.1 done: Part B built on `phase-6.1b` (D-85, 2026-11-03), stacked on `phase-6.1` (PR #7). PR: https://github.com/shanelabountyai/commons/pull/8 (base `phase-6.1`), **CI green** at `690db7b` (https://github.com/shanelabountyai/commons/actions/runs/41689302932: ci + modules-removed pass). Next for Shane: merge #5 → #6 → #7 → this PR, each into its base; confirm or reverse D-85's three calls. Next session item: **draft PRD 6.2** (upload hardening + author alt text, `docs/phase-6-tasks.md` row 6.2) for review, nothing built; stop at the draft. Model: Opus 5.5 (D-74).

**Mac session (2026-11-03, Opus 5.5, Shane's "go").** Spec first (`e2e/commons.spec.ts` 6.1 B, red: 0 of 8 comment `h3`s), then the shared `Tree` and `CommentHeading` in `src/components/forum.tsx`; the thread and permalink pages on them (h3 per comment, M2 status names, `<details open>` "N replies shown", M5 permalink and continue text, shared comment `Pager`, Edited badge, relative ages); `commons.css` type scale and one `clamp()` indent. The first sweep's axe caught `heading-order` on the permalink page (`h1` → `h3`); fixed with an `h2`.
- **Gate (local, Mac):** Playwright 22/22 on the production build (1.1 min), axe 0 on 62 measurements incl. thread / deep thread / permalink at 320/768/1280 light and dark; vitest 363/363; `xss:check` 61/61; `engine:eval` 14 files / 19,576 rows / 0 differences; `fixtures:check`, `engine:lint`, `foundation:drift`, eslint, tsc clean. Numbers: `docs/EVAL.md` §Phase 6 — 6.1 B.
- **D-85 calls for Shane:** permalink names carry the UTC minute (the PRD's handle-only name repeats when one member comments twice); the permalink page's new `h2`; the indent selector now scoped to the subtree `<ol>`, which also gives markdown ordered lists in bodies their numbers back.

---

## ▶ PRD 6.1 Part A built on `phase-6.1` (D-84, 2026-11-02), stacked on `phase-5.4b` (PRs #5 and #6 still open). PR: https://github.com/shanelabountyai/commons/pull/7 (base `phase-5.4b`), **CI green** at `dfb88d3` (https://github.com/shanelabountyai/commons/actions/runs/41537228546: ci + modules-removed pass). Next for Shane: merge #5 → #6 → this PR, each into its base; confirm or reverse D-84. Next session item: **build 6.1 Part B** (the thread: type hierarchy, `h3` per comment, M2 status names, `<details open>` "N replies shown", shared `Tree` for the permalink, `clamp` indent, M5 link text, shared `Pager`) on `phase-6.1b` off `phase-6.1`, failing e2e first. Model: Opus 5.5 pinned (D-74); Shane picked Sonnet 5.5 for Part A.

**Mac session (2026-11-02, Sonnet 5.5 by Shane's per-item pick, "go").** Shane approved the PRD's four recommendations (D-84). Spec first (`e2e/commons.spec.ts` 6.1 A, red on `h1 .badge` against the old build), then: tokens in `commons.css` (design review §2 block verbatim; meta/removed/alert/status/borders/rail moved to roles; CSS emoji gone); `Badge`, `Pager`, `Crumbs` in `src/components/forum.tsx`, `ScopeNote` now the layout `<footer>` with the owner's delete-org link; `boardPosts` pages at `BOARD_PAGE_SIZE` 25 with `page`/`pages`/`total`/`empty`; the board page's 2-column rows, `by · ago · comments` meta, shared pager, `#compose` jump link; breadcrumb navs on board/thread/permalink; empty states without CLI on Boards/board/search/profile; the queue uses `Badge`. `CLAUDE.md` "Current work" now names `docs/phase-6-tasks.md`.
- **Gate (local, Mac):** Playwright 21/21 on the production build (1.2 min of tests), axe 0 on 44 measurements incl. Boards and board page 2 at 320/768/1280 light and dark; vitest 363/363; `xss:check` 61/61; `engine:eval` 14 files / 19,576 rows / 0 differences; `fixtures:check` OK; `engine:lint`, `foundation:drift`, eslint, tsc clean. Numbers with commands: `docs/EVAL.md` §Phase 6 — 6.1 A.
- **Two spec adjustments, neither an expected value:** the `#compose` jump link first read "New post" and collided with the sort tab locator `New` (renamed "Write a post"); the 5.1 board-vote step assumed P-GW on sbc's first page (it ranks 135th under Hot, so the step now walks pages). A scoped `-g` run of 5.4 A alone fails `RATE_LIMITED` because the owner is still young by `max_contributions` 5 without the earlier specs' posts: a run-order dependency, not a defect; the full sweep is the gate.
- **Observed, not diagnosed:** the production server logs `⨯ Error: The destination stream closed early` 56 times during the sweep (clients navigating away mid-response); every spec passed. Cause unknown; check whether CI logs show it on `phase-5.4b` before treating it as new.
- **For Shane:** the three merges; D-84; `--warn` is border-only because orange over black on white is about 3.9:1 (recorded in EVAL) — say if a readable warn text colour is wanted instead.

---

## ▶ PRD 6.1 drafted on `phase-6.1` (D-83, 2026-11-02); awaiting Shane's review. Next for Shane: (1) merge PR #5 then #6 into `phase-5` (still open; Phase 6 builds only after, with CI green on `phase-5`); (2) review `docs/prd/6.1-readability-tokens.md` and answer its four decisions (two PRs or one; page size 25 as a page constant; subtree `<details>` open by default; "delete org" to the footer). Next session item: **build 6.1 Part A** once approved, on `phase-6.1` rebased onto `phase-5`. Model: Opus 5.5 pinned (D-74); Shane picked Fable 5.1 for this draft.

**Mac session (2026-11-02, Fable, Shane's "go" + item question).** Shane approved the Phase 6 list whole (6.4 kept). Doc work only, nothing built, no gate run: `docs/prd/6.1-readability-tokens.md` (Problem from design/UX/a11y reviews with what 4.1.13 already closed; Part A tokens + `Badge` + board page `take 25` and `Pager` + breadcrumb `<nav>` + scope footer + empty states; Part B thread `h3` per comment, M2 status names, `<details open>` "N replies shown" from rendered rows, shared `Tree` for the permalink, `clamp` indent, M5 link text, shared pager; acceptance as failing-first e2e with axe at 320/768/1280 light and dark), D-83, `docs/phase-6-tasks.md` 6.1 marked 📝. Branch `phase-6.1` is off `phase-5.4b` because #5/#6 are unmerged; no PR opened for a draft.
- **Found while drafting:** the members page is template-owned (`scripts/foundation-drift.ts`), so "delete org" cannot move there; the PRD sends it to the clone-owned footer. `e2e/axe.ts` measures light and dark at whatever viewport the test set, so the three-width gate is a loop in the specs, not a harness change.
- **For Shane:** the merges and the four PRD decisions above; `CLAUDE.md` "Current work" still names `docs/phase-5-tasks.md` — switch it to phase 6 in the Part A build session.

---

## ▶ Phase 5 gate passed on the 5.4 B head (D-82, 2026-11-02); stopped for review before Phase 6. Next for Shane: merge PR #5 then #6 into `phase-5` (then #4 into `main` when ready), confirm or reverse D-80..D-82, review `docs/phase-6-tasks.md`. Next session item: PRD 6.1 (readability + tokens) drafted for review — **only after** Shane approves the Phase 6 list. Model: Opus 5.5 pinned (D-74); Shane picked Fable 5.1 for 5.4 and the gate.

**Mac session (2026-11-02, Fable, Shane's "go").** Gate re-run on `f311a51` (= `phase-5` + PR #5 + PR #6): `engine:lint` OK (3 rules files), `fixtures:check` OK (22 files, 14 reproduce), `engine:eval` 14 files / 19,576 rows / 0 differences, `foundation:drift` and tsc clean, vitest 363/363 (49 files) incl. harness 14/14. Browser numbers from CI run 41529479036 (Playwright 20/20, axe 0 on 32); not re-run locally. First local vitest attempt failed 36 suites on `Invalid environment` — bare `npx vitest run` skips the `dotenv -e .env.test` loader; `npm test` is the command. Environment, not code.
- **Written:** `docs/phase-5-tasks.md` 5.4 ticked + gate line; D-82; `docs/EVAL.md` §Phase 5 — gate; `docs/phase-6-tasks.md` (6.1 readability + tokens, L, two PRs; 6.2 upload hardening + alt, M; 6.3 board descriptions, S; 6.4 §C measurements, M; carried owner decisions; declined list; Phase 6 gate). Committed on `phase-5.4b`, so PR #6 carries them.
- **For Shane:** (1) merges, as above; (2) one owner decision would close two Phase 5 caveats at once: regenerate the community fixture with bodies and organic reports under rule 8 (unlocks `min_contribution_chars` D-75 and a real community-report false-positive check D-81) — or leave both as stated caveats; (3) Phase 6 list: keep 6.4 (measure-first) in, or drop it to B5 + B6 + descriptions only; (4) `CLAUDE.md` "Current work" still names `docs/phase-5-tasks.md` — switch it to phase 6 in the PRD 6.1 session, not before approval.

---

## ▶ PRD 5.4 Part B built on `phase-5.4b` (D-81, 2026-11-02), branched off `phase-5.4a` (PR #5 not yet merged). PR: https://github.com/shanelabountyai/commons/pull/6 (base `phase-5.4a`). Next: Shane merges #5 then #6 into `phase-5`; Phase 5 has no further PRDs queued (`docs/phase-5-tasks.md`), so the next item is the Phase 5 gate / closure prompt.

**Mac session (2026-11-02, Fable by Shane's per-item pick, "go").** Part B per the PRD, fixture first: `rules/moderation.json` `report_swarm` + `lock_refuses`; `tools/modlib.py` + `tools/build_mod_fixtures.py` → `fixtures/moderation/` (8 scenarios, 44 reports, 2 signals) in the manifest; `src/limits/report-swarm.ts` (pure); `ReportSwarmSignal` table (migration `20261102120000`, hand-written, `migrate diff` empty locally); live check in `submitReport`; the queue's `REPORT_SWARM` row + `reviewSwarm`; the door's `refuseIfLocked` for reply / vote / edit. Six commits, one concern each.
- **Gate (local, Mac):** vitest 363/363 (49 files; +14 over Part A: 10 detector, 2 swarm live, 2 lock), harness 14/14 with `reviewSwarm` discovered; full Playwright 20/20 on the production build (1.0 min of tests), axe 0 on 32 measurements; `engine:eval` 14 files / 19,576 rows / 0 differences; `engine:eval:db` 2/2 swarm rows through `submitReport` over 8 scenarios (3 reports refused by the report window); `fixtures:check` OK (22 files in the manifest, 14 expected files reproduce); `engine:lint`, `foundation:drift`, `migrate diff` (empty), eslint, tsc clean. Numbers with commands: `docs/EVAL.md` §Phase 5 — 5.4 B. CI: **green** at 4839634 (https://github.com/shanelabountyai/commons/actions/runs/41529479036: ci + modules-removed pass).
- **Environment, not code:** the Mac kernel-panicked at 15:27 CT mid-session (`/Library/Logs/DiagnosticReports/panic-full-2026-11-02-152727`); Postgres recovered on its own and the gate was rerun from the start.
- **For Shane:** (1) merge PR #5 (Part A) then PR #6 (Part B) into `phase-5`; (2) confirm or reverse D-81's calls — detector under `src/limits/`, `reporterIds` kept on the signal row, strictest lock reading when no rules are passed; (3) decide whether the vacuous "community reports raise no swarm" check is worth fixing: it needs organic reports generated into the frozen community fixture (a regeneration under rule 8), or stays a stated caveat.

---

## ▶ PRD 5.4 Part A built on `phase-5.4a` (D-80, 2026-11-02); PR #5 against `phase-5` open. Next: Part B on `phase-5.4b` off `phase-5` (after A merges, or off `phase-5.4a` if not yet). Model: Opus 5.5 (D-74); Shane picked Fable 5.1 for Part A.

**Mac session (2026-11-02, Fable, Shane's "go").** Part A per the PRD: `queue()` unlimited with per-reporter records from the log, `modLog` paged with `seq` and linked targets (`src/forum/moderation.ts`); the page with `?kind=` / `?reason=` / `?page=` / `?logPage=`, counts, 240-char excerpt + `<details>`, warn / ban / unban / lock / unlock in place through `moderateUser` / `moderateThread` with `back` (same-site paths only, checked at the redirect so INV-02/03 stay first). One defect found by the sweep and fixed behind a red test: a duplicate posted in the same epoch second raised nothing (`lt` → `lte`, D-80).
- **Gate (local, Mac):** vitest 349/349 (48 files) incl. harness 14/14; full Playwright 20/20 on the production build (57.5 s of tests), axe 0 on 32 measurements incl. the filtered queue at 320 px; `engine:eval` 13 files / 19,574 rows / 0 differences; `fixtures:check`, `engine:lint`, `foundation:drift`, eslint, tsc clean. Numbers with commands: `docs/EVAL.md` §Phase 5 — 5.4 A. CI result: PR #5 https://github.com/shanelabountyai/commons/pull/5 — **CI green** at 9de96cd (https://github.com/shanelabountyai/commons/actions/runs/41510601634: ci + modules-removed pass).
- **Part B (next, one session):** `fixtures/moderation/scenarios.json` + `tools/modlib.py` + `expected_report_signals.csv` first (4 reporters under 7 days in 24 h, same target author; the four scenarios in the PRD), hashed in the manifest; then the `REPORT_SWARM` queue item (signal only, D-31) with `rules/moderation.json` `report_swarm`; `lock_refuses: ["reply","vote","edit"]` with red tests in `actions.test.ts` first; `engine:eval` and `engine:eval:db` extended; community fixture untouched. The queue page already filters by `kindOf(item)`: add `REPORT_SWARM` to `KINDS` and a heading, nothing else in the UI.
- **For Shane:** review/merge the Part A PR into `phase-5`; confirm or reverse D-80's two calls (author/thread actions under a per-case `<details>`; the `lte` duplicate fix counted as a defect, not a rule change).

---

## ▶ Phase 5 in progress on `phase-5` (2026-11-01). PRD 5.3 approved and built: `tools/rank_study.py`, numbers in `docs/EVAL.md` §Phase 5. Post-study decisions taken (D-71 keep gravity, D-72 keep D-12 in Best, D-73 no limits change; 5.2 builds its own fixtures). PRD 5.2 approved (D-75) and built (D-76): RING and AGED_BRIGADE signals as data, fixture first; local gate green incl. Playwright 18/18. Model now Opus 5.5 (D-74). PRD 5.1 approved (D-77) and built (D-78): vote control with pressed state, one click, author's fixed +1, gate named; full Playwright 19/19. CI green on PG 17 at `63cee2a` (run 41476591049; 5.3 + 5.2 + 5.1 on PR #4). Remaining Phase 5: PRD 5.4 (mod queue v2) drafted at `docs/prd/5.4-mod-queue-v2.md`, awaiting Shane's call (A+B, A only, or other thresholds).

- **5.3 result:** Hot ≈ New on every board at gravity 45k/90k/150k (ρ ≥ 0.981, 0 hot-only top-5 posts); Best is pure tiebreak in 120/878 sibling groups; dropping the author's +1 from Best changes 45/878 top comments; the fixture cannot calibrate the age gate, aged-brigade signal or comment window (no aged sockpuppets; generator comment timestamps). Phase 4.1 merged as `091435f` (D-70).

**Phase 4.1 session (2026-10-30, cloud, Shane's "go").** 15 defect rows from the review gate, each fixed behind a red test, one concern per commit on `phase-4.1` (21 commits incl. the plan). Decisions D-65..D-68.
- **Gate output:** `npm test` 332/332 (46 files); harness 14/14 with `deleteOwn` and `moderatorFlag`; `xss:check` 61/61 (D-61 cases added, red first); `engine:eval` 0 differences; `fixtures:check` OK (manifest regenerated, 12 expected CSVs byte-identical); `engine:lint` OK with the new single-door rule (proven red on the old edit import); drift clean; tsc clean; eslint 0; full Playwright 18/18 against the production build in 2.6 min, axe 0 light+dark incl. 320 px and after an action; audit 15 advisories, 0 added. Every number with its command: `docs/EVAL.md` §Phase 4.1.
- **Found while patching:** the two D-61 fixture cases pushed the capstone's thread past 50 top-level comments, so the XSS walk now checks storage and scans every page; the dev server's first compile can outlast a 5 min test (seen once; CI uses the production build).
- **Found by CI, not locally (D-69):** the template's `.gitignore` `uploads/` had hidden `src/app/o/[org]/f/uploads/*` from every commit since Phase 4; local runs passed because the files were on disk. Now committed; `npm run repo:ignored` guards the class; CI posts Playwright failure context as a PR comment (the only channel a cloud session can read).
- **Sandbox:** everything ran locally; Postgres had to be restarted (`service postgresql start`) after the overnight idle.

| CI run | Head | Result |
|---|---|---|
| Phase 4.1 head | df78efb | **success** https://github.com/shanelabountyai/commons/actions/runs/41139192206 (repo:ignored, lints, eval, fixtures, migrate diff, eval:db, ADR, abuse suites, vitest, full Playwright 18/18 on PG 17). Four earlier runs on this branch failed only on 4.1.6: the upload route files had never been committed (D-69) |
| Phase 4 head | 63dad8a | **success** https://github.com/shanelabountyai/commons/actions/runs/40967135925 (merged as 5f0ba21) |

**Decisions for Shane:** merge PR #3 or not; confirm or reverse D-65..D-68. Then the Phase 5 PRDs (`docs/phase-5-tasks.md`, D-59), presented one at a time before any build.

**Upstream for saas-foundation (new this phase):** D-67 (ActionForm loses typed input and focus on refusal); D-69 (`uploads/` in the template .gitignore is too broad).

---

## Review gate done; Phase 4.1 planned (2026-10-30). (superseded by the block above)

---

## Phase 4 DONE — the build is closed; stopped at the gate (2026-10-29). (superseded by the block above; PR #1 merged 2026-10-30)

**Phase 4 build session (2026-10-29 ~5–6 PM CT, Fable, cloud, Shane's "go now").**
- Built per `docs/phase-4-tasks.md`, one concern per commit on `phase-1`: `rules/moderation.json` + schema + append-only trigger (4.1) → report / act / queue / state machines (4.2) → duplicate signal (4.5) → pages, mod queue, profile, search, uploads (4.3, 4.4, 4.6, 4.7) → browser capstone with axe (4.8) → `commons:demo` + `docs/DEMO.md` (4.8) → EVAL §4, WRITEUP, CLOSEOUT (4.9). Defaults D-48..D-54, gate D-55.
- **Gate output:** `npm test` 316/316 (44 files); harness 14/14 (10 forum actions under INV-01..04/22); `next build` clean; lint 0; typecheck clean; drift clean; `engine:lint` OK; `engine:eval` 0 differences; `xss:check` 59/59; `fixtures:check` OK; e2e capstone 5/5 in 3.2 min, axe 0 violations light+dark on 10 page loads; demo numbers in `docs/DEMO.md`. Every number with its command: `docs/EVAL.md` §Phase 4.
- **Found while building, all recorded:** the moderator role has to be a Profile flag because `Role` is template-owned (D-48); the append-only trigger also refuses deleting an org that holds log rows (D-49); XSS fixture X-37 (a NUL byte) was inert on the page but a Postgres 500 on write — failing test first, then refused at the door (D-53); `npm audit` 15 advisories, 0 from Phase 4 (D-54).
- **Sandbox:** everything ran locally (PG 16.15, Chromium from /opt/pw-browsers) except `migrate diff` and `check-modules` (CI-only, as before). Three demo orgs (`demo-2026102922*`) remain in the local `commons` database; they cannot be deleted (D-49) and don't matter.

| CI run | Head | Result |
|---|---|---|
| Phase 4 head | 63dad8a | **success** https://github.com/shanelabountyai/commons/actions/runs/40967135925 (full Playwright 14/14 incl. the capstone, migrate diff, eval:db, ADR, abuse suites, vitest, all green on PG 17). First Phase 4 run f3afb1b **failed** on Playwright (run 40965329908) → D-56 log order, D-57 onboarding spec |
| Phase 3 head | 9bbee84 | **success** https://github.com/shanelabountyai/commons/actions/runs/40954954426 |
| Phase 2 head | 3161dfe | success https://github.com/shanelabountyai/commons/actions/runs/40946970972 |
| Phase 1 head | c61c198 | success https://github.com/shanelabountyai/commons/actions/runs/40930385079 |

**Decisions for Shane:** confirm or reverse D-48..D-54 (and D-41..D-46 if not yet). Deploy stays a separate decision: not planned; D-51 names the one seam (two file functions in `src/forum/uploads.ts`).

**By hand (Shane):** `docs/CLOSEOUT.md` § By hand — review/merge PR #1, reuse scan on the Mac, the two upstream items for saas-foundation (security release; a `Role` extension point), build-log card #16, brief + LinkedIn.

---

## Phase 3 DONE; stopped at the gate (2026-10-29). (superseded by the block above)

**Phase 3 build session (2026-10-29 ~4 PM CT, Fable, cloud, Shane's "run it now").**
- Built per `docs/phase-3-tasks.md` (uploads deferred, D-40), one concern per commit on `phase-1`: XSS fixture set first (3.1) → the two sanitizer packages at pinned versions (D-38) and `src/render` as the single sanitizer module with `xss:check` (3.2/3.3) → `LimitHit` table (3.4) → limits store, action door, live gates (3.4/3.5/3.8) → abuse suites and per-code tests (3.7/3.8) → CI (3.9). Defaults D-41..D-46, gate D-47; `docs/phase-4-tasks.md` written for review.
- **Gate output:** `xss:check` 59/59 inert; `abuse:spam` 2/1/20 allowed (retryAfter 58/3540/50) and `abuse:normal` 0 refused through the live store, equal to `expected_limits.csv`; `npm test` 307/307 (42 files); lint 0; typecheck clean; `foundation:drift` clean; `engine:lint` OK with the single-writer and single-renderer rules. Every number with its command: `docs/EVAL.md` §Phase 3.
- **Two findings while building, both recorded:** the fixture's first "live" patterns flagged entity-encoded (inert) text, so they were anchored on real tags before the renderer was judged (D-41); markdown-it silently drops content past its nesting limit, so runs of more than 8 quote/list markers are flattened first (D-42).
- **Audit:** the new packages add no advisories; nine pre-existing ones are template dependencies, `next` at **critical** (D-46). **For saas-foundation:** a `security:` release bumping `next` (and `prisma`, `zod`) is due under the template's own 7-day rule; clones take it after.
- **Sandbox:** everything ran locally except `migrate diff` and `check-modules` (CI-only, as before).

| CI run | Head | Result |
|---|---|---|
| Phase 3 head | 9bbee84 | **success** https://github.com/shanelabountyai/commons/actions/runs/40954954426 (xss:check, eval:db, ADR, abuse suites, vitest, e2e all green on PG 17) |
| Phase 2 head | 3161dfe | success https://github.com/shanelabountyai/commons/actions/runs/40946970972 |
| Phase 1 head | c61c198 | success https://github.com/shanelabountyai/commons/actions/runs/40930385079 |

**Decisions needed from Shane before Phase 4** (`docs/phase-4-tasks.md`): the `moderator` role shape, whether Handhold's report reasons are copied or re-chosen for homelab, and deploy yes/no. Also: confirm or reverse D-41..D-46.

**By hand (Shane):** review and merge PR #1 when ready (now Phases 1–3); the template's `next` security release.

---




**Kickoff session (2026-10-29, cloud, Shane present).**
- Owner decisions: public repo, homelab theme, Commons runs alone (D-1..D-3).
- Kit: PRD v1.1 (homelab, Footnote replaces "Askboard" in P1-4, phasing amended per D-6), CLAUDE.md, KICKOFF.md, decisions D-4..D-18 + O-1..O-3, domain brief, ADR-001 (proposed), overlap check, Phase 1 tasks, `rules/ranking.json`, `rules/limits.json`, `tools/rankinglib.py` + `tools/golden_answers.py`.
- Gate output: `python3 -I tools/golden_answers.py` → `18 cases OK`. Two values hand-checked: hot(50, 0, T0) = 14650.6766811, wilson(70, 100) = 0.60415.
- Template: v1.4.0 is the latest tag (D-4). Port 7500 verified free and added to the `~/.claude/CLAUDE.md` port table on the Mac 2026-10-29 (D-5).
- Not done here: no template clone, no `npm ci`, no app code. `main` doesn't exist on origin yet; the Phase 1 session pushes the untouched template v1.4.0 as `main` and builds on `phase-1`.

**Mac session (2026-10-29):** port row added; reuse scan run (D-19): Handhold is a moderation-queue donor the overlap doc had missed; flat comments and a regex sanitizer there are not donors. KICKOFF step 2 now names the sibling clone folder `~/Projects/commons-app`.

**By hand (Shane):** see KICKOFF.md § Still to do by hand.
