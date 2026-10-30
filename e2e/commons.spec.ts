// Phase 4 capstone from pages (task 4.8): the seeded community loaded into the owner's org through the writers;
// boards → Hot/Top/New → a thread with the deep chain and continue-thread → reply, vote, edit → an XSS body posted
// through the real form renders inert in a real browser → report → mod queue → remove → restore → the append-only
// log; the brigade signal from the fixture sits in the queue. axe in light and dark on every page (A-096).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { expectAccessible } from './axe';
import { memberFor, ownerFor } from './commons-helpers';

test.use({ bypassCSP: true }); // axe is injected; the app's CSP (INV-15) rightly refuses that
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const SLUG = `homelab-e2e-${Date.now()}`;
const owner = ownerFor(SLUG);
const member = memberFor(SLUG);
let orgId = '';
const xssCases = (JSON.parse(readFileSync('fixtures/xss/cases.json', 'utf8')) as { cases: { id: string; class: string; input: string }[] }).cases;

test.beforeAll(async () => {
  test.setTimeout(900_000); // the fixture load through the writers is ~1k posts and ~10k comments; hooks default to 30 s
  orgId = await owner.setup(db);
  await member.setup(db, orgId);
  // the fixture community through the real writers (same path as engine:eval:db), in one transaction
  const { loadFixtures } = await import('../src/fixtures/load');
  const { loadForum } = await import('../src/forum/load');
  const { recomputeRanks } = await import('../src/forum/rank');
  const { parseLimitRules, parseRankingRules } = await import('../src/rules');
  const { db: prisma } = await import('../src/core/db');
  const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
  const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
  await prisma.$transaction((tx) => loadForum(tx, orgId, loadFixtures(), limits), { timeout: 900_000, maxWait: 10_000 });
  await prisma.$transaction((tx) => recomputeRanks(tx, orgId, Math.floor(Date.now() / 1000), ranking), { timeout: 120_000 });
  await prisma.$disconnect();
});
test.afterAll(() => db.end());
const signIn = (page: Page) => owner.signIn(db, page);

test('boards and a board under Hot, Top and New, ranked by the job', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f`);
  await expectAccessible(page, 'boards', 'Boards');
  await expect(page.getByRole('link', { name: 'networking' })).toBeVisible();
  await page.getByRole('link', { name: 'selfhosting' }).click();
  await expectAccessible(page, 'board hot', 'Hot');
  await expect(page.getByText(/ranked \d+ min ago/)).toBeVisible();
  const hotFirst = await page.locator('ol li.post a').first().textContent();
  await page.getByRole('link', { name: 'Top all time' }).click();
  await expect(page.getByRole('link', { name: 'Top all time' })).toHaveAttribute('aria-current', 'page');
  const topFirst = await page.locator('ol li.post a').first().textContent();
  expect(topFirst).toContain('P-GH-50'); // 50 votes, the fixture's top-all winner (expected_post_order_top_all.csv)
  expect(hotFirst).not.toBeNull();
  await page.getByRole('link', { name: 'New' }).click();
  await expectAccessible(page, 'board new', 'New');
});

test('the deep thread: removed and deleted comments in place, continue-thread, permalink with ancestors', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f/p/P-CHAIN`);
  await expectAccessible(page, 'thread P-CHAIN', 'P-CHAIN title');
  await expect(page.getByText('[deleted]')).toBeVisible(); // C-CHAIN-3, author delete, subtree kept
  await expect(page.getByText('[removed]')).toBeVisible(); // C-CHAIN-5, moderator removal
  await expect(page.getByText('11 comments · 2 top-level shown')).toBeVisible(); // two dead leaves hidden (D-13)
  await page.getByRole('link', { name: 'Continue this thread →' }).first().click();
  await expectAccessible(page, 'permalink C-CHAIN-6', 'Comment in context');
  await expect(page.getByRole('list', { name: 'Ancestors' }).getByRole('listitem')).toHaveCount(6);
  await expect(page.getByText('depth 1')).toBeVisible(); // C-CHAIN-7 under the re-rooted C-CHAIN-6
});

test('reply, vote, edit; a young-looking owner cannot downvote yet; refusals carry their code', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f/p/P-GW`);
  await page.getByLabel('New comment').fill('A **reply** from the e2e owner with a [link](https://ok.example).');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.locator('ol.thread')).toContainText('A reply from the e2e owner');
  const mine = page.locator('li.c', { hasText: 'A reply from the e2e owner' }).first();
  const open = (li: ReturnType<typeof page.locator>) => li.locator('summary').first().click(); // <summary> has no button role
  await expect(mine.locator('a[rel="nofollow ugc noopener"]')).toHaveAttribute('href', 'https://ok.example');
  // vote on someone else's comment: the owner's profile is minutes old → downvote is gated, upvote applies
  const other = page.locator('li#C-GW-10-10'); // li ids are the public comment ids
  await open(other);
  await other.getByRole('button', { name: /Downvote comment/ }).click();
  await expect(page.getByRole('status')).toContainText('GATED_DOWNVOTE');
  await page.goto(`/o/${SLUG}/f/p/P-GW`);
  await open(mine);
  await mine.getByLabel('Edit your comment').fill('Edited within the window.');
  await mine.getByRole('button', { name: 'Save edit' }).click();
  await expect(page.locator('ol.thread')).toContainText('Edited within the window.');
  await expect(page.locator('ol.thread')).not.toContainText('· edited'); // inside 900 s, no mark (D-32)
  await expectAccessible(page, 'thread after reply', 'P-GW title');
});

test('every XSS fixture body posted through the real form renders inert in a real browser', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f/p/P-0001`);
  const bodies = xssCases.filter((c) => c.class === 'markdown' && c.input.length < 5000);
  let fired = false;
  page.on('dialog', async (d) => {
    fired = true;
    await d.dismiss();
  });
  // the comment limit is 6/min for a mature account and 2/min for a young one; the owner is young, so lift it for this walk
  await db.query(`UPDATE "Profile" SET "joinedAt" = now() - interval '30 days' WHERE "orgId" = $1 AND "handle" LIKE 'owner%'`, [orgId]);
  await db.query(`INSERT INTO "Post" (id, "orgId", "boardId", "authorId", "publicId", title, body, "createdAt")
    SELECT gen_random_uuid(), p."orgId", b.id, p.id, 'P-SEED-' || g, 's', 's', now() - interval '20 days'
    FROM "Profile" p, "Board" b, generate_series(1, 6) g WHERE p."orgId" = $1 AND p."handle" LIKE 'owner%' AND b."orgId" = $1 AND b.slug = 'help'`, [orgId]);
  let accepted = 0;
  const refusedIds: string[] = [];
  for (const c of bodies) {
    await db.query(`DELETE FROM "LimitHit" WHERE "orgId" = $1`, [orgId]); // one case per attempt; the limit itself is proven by abuse:spam
    const before = await page.locator('ol.thread li.c').count();
    await page.getByLabel('New comment').fill(c.input);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    // either the comment is stored and rendered inert, or the door refuses it with a code — never a 500
    const alert = page.locator('p[role="alert"]'); // the form's own; Next's route announcer is also role=alert
    await expect(page.locator('ol.thread li.c').nth(before).or(alert)).toBeVisible();
    if ((await page.locator('ol.thread li.c').count()) > before) accepted += 1;
    else {
      await expect(alert).toContainText('INPUT_INVALID');
      refusedIds.push(c.id);
      await page.goto(`/o/${SLUG}/f/p/P-0001`);
    }
  }
  expect(refusedIds).toEqual(['X-37']); // the NUL-byte body is refused at the door (actions.test.ts); everything else is stored
  expect(accepted).toBe(bodies.length - 1);
  const live = await page.evaluate(() => {
    const bad: string[] = [];
    // the rendered bodies only (div.body is the one sanitizer output); the thread's own forms sit beside them
    for (const el of Array.from(document.querySelectorAll('ol.thread div.body *'))) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'img', 'svg', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'math'].includes(tag)) bad.push(tag);
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) bad.push(`${tag}@${a.name}`);
        if ((a.name === 'href' || a.name === 'src') && /^\s*(javascript|data|vbscript):/i.test(a.value)) bad.push(`${tag}@${a.name}=${a.value.slice(0, 20)}`);
      }
    }
    return bad;
  });
  expect(await page.locator('ol.thread div.body').count()).toBeGreaterThanOrEqual(accepted);
  expect(live).toEqual([]);
  expect(fired).toBe(false);
  await expectAccessible(page, 'thread with hostile bodies', 'P-0001 title');
});

test('report → queue (with the fixture brigade) → remove → restore → append-only log', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f/p/P-BRIGADE`);
  await page.locator('article[aria-label="Post"] summary').first().click();
  await page.getByLabel('Reason for reporting this post').selectOption('spam');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reported');
  await page.goto(`/o/${SLUG}/f/mod`);
  await expectAccessible(page, 'mod queue', 'Moderation queue');
  await expect(page.getByRole('heading', { name: /Reported \(1\): spam/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Suspected brigade: 7 gated downvotes/ })).toBeVisible();
  const item = page.getByRole('region', { name: /CASE on P-BRIGADE title/ });
  await item.getByLabel('Reason for P-BRIGADE title').fill('affiliate spam');
  await item.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: /Reported \(1\)/ })).toHaveCount(0);
  await expect(page.locator('table tbody tr').first()).toContainText('REMOVE');
  await page.goto(`/o/${SLUG}/f/p/P-BRIGADE`);
  await expect(page.getByText('This post was removed; the body is below for moderators.')).toBeVisible();
  await page.locator('article[aria-label="Post"] summary').first().click();
  await page.getByLabel('Moderation reason for this post').fill('appeal upheld');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('heading', { name: 'P-BRIGADE title' })).toBeVisible();
  await page.goto(`/o/${SLUG}/f/mod`);
  const rows = page.locator('table tbody tr');
  await expect(rows.nth(0)).toContainText('RESTORE');
  await expect(rows.nth(1)).toContainText('REMOVE');
  const { rows: log } = await db.query(`SELECT count(*)::int AS n FROM "ModerationAction" WHERE "orgId" = $1`, [orgId]);
  expect(log[0].n).toBe(2);
  await expect(db.query(`DELETE FROM "ModerationAction" WHERE "orgId" = $1`, [orgId])).rejects.toThrow(/append-only/);
  // search finds the post by a word in its title; profile page lists it
  await page.goto(`/o/${SLUG}/f/search?q=P-BRIGADE`);
  await expectAccessible(page, 'search', 'Search');
  await expect(page.getByRole('link', { name: 'P-BRIGADE title' })).toBeVisible();
});

// ---- Phase 4.1 defect patch: each assertion below was red before its fix (docs/phase-4.1-tasks.md) ----

test('4.1.5–4.1.7: a member sees no hot score; a vote answers with its outcome and keeps the panel open; edit returns to the node', async ({ page }) => {
  await member.signIn(db, page);
  await page.goto(`/o/${SLUG}/f/p/P-GW`);
  await expect(page.locator('article[aria-label="Post"] .meta')).not.toContainText(/\bhot \d/); // D-9: the score is for the eval and moderators
  await expect(page.locator('article[aria-label="Post"] .meta')).toContainText(/ranked/);
  // a 0-minute-old member: upvote applies; the same button again toggles it off; each outcome is announced (4.1.7)
  const target = page.locator('li#C-GW-1-1');
  await target.locator('summary').first().click();
  await target.getByRole('button', { name: /Upvote comment/ }).click();
  await expect(target.getByRole('status')).toContainText('APPLIED');
  await expect(target.locator('details').first()).toHaveAttribute('open', ''); // no redirect: the panel stays open
  await target.getByRole('button', { name: /Upvote comment/ }).click();
  await expect(target.getByRole('status')).toContainText('TOGGLED_OFF');
  // the member edits their own reply and lands on it, not at the top of the thread
  await page.getByLabel('New comment').fill('A reply the member will edit.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const mine = page.locator('li.c', { hasText: 'A reply the member will edit.' }).first();
  await mine.locator('summary').first().click();
  await mine.getByLabel('Edit your comment').fill('A reply the member edited.');
  await mine.getByRole('button', { name: 'Save edit' }).click();
  await expect(page.locator('ol.thread')).toContainText('A reply the member edited.');
  await expect(page).toHaveURL(/#C-[A-Za-z0-9-]+$/);
});

test('4.1.6: an upload refusal is visible without opening anything', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${SLUG}/f/p/P-GW`);
  // the owner is not P-GW's author: create an own post first through the board form
  await page.goto(`/o/${SLUG}/f/selfhosting`);
  await page.getByLabel('Title').fill('Upload refusal check');
  await page.getByLabel(/^Body/).fill('A post to attach a bad file to.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upload refusal check' })).toBeVisible();
  const post = page.locator('article[aria-label="Post"]');
  await post.locator('summary').first().click();
  await post.getByLabel(/Attach an image/).setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)></svg>') });
  await post.getByRole('button', { name: 'Attach' }).click();
  await expect(page.locator('p[role="alert"]')).toBeVisible(); // not inside a closed <details>
  await expect(page.locator('p[role="alert"]')).toContainText('INPUT_INVALID');
});
