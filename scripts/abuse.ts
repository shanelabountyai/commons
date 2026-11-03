// abuse:spam / abuse:normal (task 3.7): the Phase 1 limit scripts replayed through the LIVE store and the action
// door, not the pure engine. Builds a throwaway org in the test database, drives the attempts through
// guardAndRecord with the same young-account inputs the fixture implies, and diffs allowed/refused/first
// retryAfter against fixtures/expected_limits.csv. Exit 1 on any difference. --suite spam|normal.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { expectedRows, loadFixtures, NOW } from '@/fixtures/load';
import { toDate } from '@/forum/db';
import { RateLimited, submitComment, submitPost } from '@/forum/actions';
import { guardAndRecord, guardThread } from '@/forum/limits-store';
import { createComment, replyDepth } from '@/forum/tree-write';
import { isYoung } from '@/limits';
import type { Action } from '@/rules';
import { parseLimitRules, parseModerationRules } from '@/rules';

const suiteArg = process.argv.indexOf('--suite');
const suite = (suiteArg >= 0 ? process.argv[suiteArg + 1] : 'spam') as 'spam' | 'normal';
const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const fx = loadFixtures();
const expected = expectedRows('expected_limits.csv');
const SLUG = `abuse-${suite}`;

await db.org.deleteMany({ where: { slug: SLUG } });
await db.user.deleteMany({ where: { email: { endsWith: `-${SLUG}@example.com` } } }); // users outlive the org they are dropped with; a rerun would collide
const org = await db.org.create({ data: { slug: SLUG, name: SLUG } });

/** A profile for fixture user `uid`, with the contributions the fixture gives them, materialised as posts so L-5 reads them. */
async function profileFor(uid: string): Promise<string> {
  const u = fx.users.find((x) => x.id === uid)!;
  const user = await db.user.create({ data: { email: `${uid}-${SLUG}@example.com`, name: u.handle } });
  await db.membership.create({ data: { orgId: org.id, userId: user.id, role: 'member' } });
  const p = await db.profile.create({ data: { orgId: org.id, userId: user.id, handle: u.handle, joinedAt: toDate(u.created_at) } });
  // contributions: the user's own fixture posts and comments (not removed), as bare Post rows with their timestamps
  const board = (await db.board.findFirst({ where: { orgId: org.id } })) ?? (await db.board.create({ data: { orgId: org.id, slug: 'help', title: 'Help' } }));
  const mine = [...fx.posts.filter((x) => x.author === uid && x.status !== 'removed').map((x) => x.created_at), ...fx.comments.filter((x) => x.author === uid && x.status !== 'removed').map((x) => x.created_at)];
  for (const [i, at] of mine.entries()) await db.post.create({ data: { orgId: org.id, boardId: board.id, authorId: p.id, publicId: `${uid}-c${i}`, title: 'c', body: 'c', createdAt: toDate(at) } });
  return p.id;
}

const t0 = NOW - 3600;
const scripts: { script: string; action: Action; user: string; attempts: number[] }[] =
  suite === 'spam'
    ? [
        { script: 'spam-young-comments', action: 'comment', user: 'u193', attempts: Array.from({ length: 60 }, (_, i) => t0 + i) },
        { script: 'spam-young-posts', action: 'post', user: 'u193', attempts: Array.from({ length: 20 }, (_, i) => t0 + 60 * i) },
        { script: 'spam-young-votes', action: 'vote', user: 'u193', attempts: Array.from({ length: 100 }, (_, i) => t0 + i) },
        { script: 'spam-young-uploads', action: 'upload', user: 'u193', attempts: Array.from({ length: 30 }, (_, i) => t0 + 10 * i) }, // PRD 6.2 (D-87)
      ]
    : [
        { script: 'normal-u050-posts', action: 'post', user: 'u050', attempts: fx.posts.filter((p) => p.author === 'u050').map((p) => p.created_at).sort((a, b) => a - b) },
        { script: 'normal-u050-comments', action: 'comment', user: 'u050', attempts: fx.comments.filter((c) => c.author === 'u050').map((c) => c.created_at).sort((a, b) => a - b) },
        { script: 'normal-u050-votes', action: 'vote', user: 'u050', attempts: fx.votes.filter((v) => v.voter === 'u050').map((v) => v.cast_at).sort((a, b) => a - b) },
      ];

let failed = false;
const profiles = new Map<string, string>();
for (const s of scripts) {
  if (!profiles.has(s.user)) profiles.set(s.user, await profileFor(s.user));
  const profileId = profiles.get(s.user)!;
  let allowed = 0;
  let refused = 0;
  let first: number | null = null;
  for (const at of s.attempts) {
    const r = await db.$transaction((tx) => guardAndRecord(tx, { orgId: org.id, profileId, action: s.action, at }, rules));
    if (r.verdict === 'allow') allowed++;
    else {
      refused++;
      first ??= r.retryAfter;
    }
  }
  const e = expected.find((x) => x['script'] === s.script)!;
  const want = { attempts: Number(e['attempts']), allowed: Number(e['allowed']), refused: Number(e['refused']), first: e['first_retry_after'] === '' ? null : Number(e['first_retry_after']) };
  const got = { attempts: s.attempts.length, allowed, refused, first };
  const ok = JSON.stringify(want) === JSON.stringify(got);
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${s.script.padEnd(22)} attempts ${got.attempts}, allowed ${got.allowed}, refused ${got.refused}, first retryAfter ${got.first ?? '-'}${ok ? '' : `  (expected allowed ${want.allowed}, refused ${want.refused}, first ${want.first ?? '-'})`}`);
}
// PRD 6.4 (D-93): the comment scripts. Spam: through the whole door (submitComment) on fresh posts. Normal: every
// community comment in time order through the live depth (tree writer) and thread window (Comment rows); each comment
// is written whatever the verdicts, so a nonzero refused count is a DIFF, never a different tree.
type Tally = { allowed: number; refused: number; first: number | null };
const tally = (): Tally => ({ allowed: 0, refused: 0, first: null });
function report(script: string, got: Tally, attempts: number) {
  const e = expected.find((x) => x['script'] === script)!;
  const want = { attempts: Number(e['attempts']), allowed: Number(e['allowed']), refused: Number(e['refused']), first: e['first_retry_after'] === '' ? null : Number(e['first_retry_after']) };
  const ok = JSON.stringify(want) === JSON.stringify({ attempts, ...got });
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${script.padEnd(22)} attempts ${attempts}, allowed ${got.allowed}, refused ${got.refused}, first retryAfter ${got.first ?? '-'}${ok ? '' : `  (expected allowed ${want.allowed}, refused ${want.refused}, first ${want.first ?? '-'})`}`);
}
const board = (await db.board.findFirst({ where: { orgId: org.id } })) ?? (await db.board.create({ data: { orgId: org.id, slug: 'help', title: 'Help' } }));
const anyProfile = profiles.values().next().value ?? (await profileFor('u050'));
const newPost = (publicId: string, at: number) => db.post.create({ data: { orgId: org.id, boardId: board.id, authorId: anyProfile, publicId, title: publicId, body: publicId, createdAt: toDate(at) } });
if (suite === 'spam') {
  const u050 = profiles.get('u050') ?? (await profileFor('u050'));
  const door = async (t: Tally, postId: string, parentId: string | null, publicId: string, at: number): Promise<string | null> => {
    try {
      const r = await db.$transaction((tx) => submitComment(tx, { orgId: org.id, profileId: u050, postId, parentId, publicId, body: 'flood', at }, rules));
      t.allowed++;
      return r.id;
    } catch (e) {
      t.refused++;
      if (e instanceof RateLimited) t.first ??= e.retryAfter;
      else if ((e as { code?: string }).code !== 'INPUT_INVALID') throw e;
      return null;
    }
  };
  const flood = await newPost('P-FLOOD', t0 - 60);
  const ft = tally();
  for (let i = 0; i < 360; i++) await door(ft, flood.id, null, `FLOOD-${i}`, t0 + 10 * i);
  report('spam-flood-thread', ft, 360);
  const deep = await newPost('P-DEEP', NOW - 60 * 400 - 60);
  const dt = tally();
  let parent: string | null = null;
  for (let i = 0; i < 60; i++) parent = (await door(dt, deep.id, parent, `DEEP-${i}`, NOW - 60 * 400 + 400 * i)) ?? parent;
  report('spam-deep-chain', dt, 60);
  // PRD 6.4 §3: attack-only measures, printed and recorded in docs/EVAL.md; no expected row, no rule (D-93 (3))
  const modRules = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
  const posted = async (publicId: string, body: string, at: number, m = modRules) => (await db.$transaction((tx) => submitPost(tx, { orgId: org.id, profileId: u050, boardId: board.id, publicId, title: 'Great NAS deal', body, at }, rules, m))).duplicate;
  let linkDupes = 0;
  for (let i = 0; i < 20; i++) linkDupes += Number(await posted(`LINK-${i}`, `Deal number ${i}: wording ${'abcdefghijklmnopqrst'[i]} changes each time, see https://deal-${i}.example.test/nas`, NOW + 86_400 + 900 * i));
  console.log(`info link hosts: 20 posts, 20 hosts, duplicate signals raised ${linkDupes}`);
  for (const w of [modRules.duplicate.window_seconds, 604_800]) {
    const m = { ...modRules, duplicate: { ...modRules.duplicate, window_seconds: w } };
    let dupes = 0;
    for (let i = 0; i < 7; i++) dupes += Number(await posted(`REPOST-${w}-${i}`, `The same affiliate NAS deal, reposted every 25 hours (run ${w})`, NOW + 2 * 86_400 + (w === 604_800 ? 10 * 86_400 : 0) + 25 * 3600 * i, m));
    console.log(`info repost: 7 posts 25 h apart, duplicate window ${w} s, signals raised ${dupes}`);
  }
  console.log('info pins: none scripted; no member path (pinning is a logged moderator action, actOnThread)');
} else {
  const ids = new Map<string, string>();
  for (const u of fx.users) {
    const user = await db.user.create({ data: { email: `${u.id}-thread-${SLUG}@example.com`, name: u.handle } });
    ids.set(u.id, (await db.profile.create({ data: { orgId: org.id, userId: user.id, handle: `${u.handle}-t`, joinedAt: toDate(u.created_at) } })).id);
  }
  const posts = new Map<string, string>();
  for (const p of fx.posts) posts.set(p.id, (await newPost(p.id, p.created_at)).id);
  const authored = new Map<string, number[]>();
  for (const r of [...fx.posts, ...fx.comments]) if (r.status !== 'removed') authored.set(r.author, [...(authored.get(r.author) ?? []), r.created_at]);
  const contributions = (u: string, t: number) => (authored.get(u) ?? []).filter((x) => x < t).length;
  const created = new Map(fx.users.map((u) => [u.id, u.created_at]));
  const thread = tally();
  const depth = tally();
  const comments = new Map<string, string>();
  for (const c of [...fx.comments].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))) {
    await db.$transaction(async (tx) => {
      const parentId = c.parent_id ? comments.get(c.parent_id)! : null;
      if ((await replyDepth(tx, parentId)) > rules.max_depth_written) depth.refused++;
      else depth.allowed++;
      const young = isYoung({ created_at: created.get(c.author)!, contributions: contributions(c.author, c.created_at) }, c.created_at, rules);
      const v = await guardThread(tx, { profileId: ids.get(c.author)!, postId: posts.get(c.post_id)!, at: c.created_at, young }, rules);
      if (v.verdict === 'allow') thread.allowed++;
      else {
        thread.refused++;
        thread.first ??= v.retryAfter;
      }
      comments.set(c.id, (await createComment(tx, { orgId: org.id, postId: posts.get(c.post_id)!, parentId, authorId: ids.get(c.author)!, publicId: c.id, body: 'c', createdAt: c.created_at })).id);
    });
  }
  report('normal-community-thread', thread, fx.comments.length);
  report('normal-community-depth', depth, fx.comments.length);
}

const rows = await db.limitHit.count({ where: { orgId: org.id } });
await db.org.delete({ where: { id: org.id } });
await db.$disconnect();
console.log(`abuse:${suite}: ${failed ? 'FAIL' : 'OK'} — ${scripts.length + 2} scripts through the live LimitHit store (${rows} rows written, org dropped)`);
if (failed) process.exit(1);
