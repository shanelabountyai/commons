// abuse:spam / abuse:normal (task 3.7): the Phase 1 limit scripts replayed through the LIVE store and the action
// door, not the pure engine. Builds a throwaway org in the test database, drives the attempts through
// guardAndRecord with the same young-account inputs the fixture implies, and diffs allowed/refused/first
// retryAfter against fixtures/expected_limits.csv. Exit 1 on any difference. --suite spam|normal.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { expectedRows, loadFixtures, NOW } from '@/fixtures/load';
import { toDate } from '@/forum/db';
import { guardAndRecord } from '@/forum/limits-store';
import type { Action } from '@/rules';
import { parseLimitRules } from '@/rules';

const suiteArg = process.argv.indexOf('--suite');
const suite = (suiteArg >= 0 ? process.argv[suiteArg + 1] : 'spam') as 'spam' | 'normal';
const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const fx = loadFixtures();
const expected = expectedRows('expected_limits.csv');
const SLUG = `abuse-${suite}`;

await db.org.deleteMany({ where: { slug: SLUG } });
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
const rows = await db.limitHit.count({ where: { orgId: org.id } });
await db.org.delete({ where: { id: org.id } });
await db.$disconnect();
console.log(`abuse:${suite}: ${failed ? 'FAIL' : 'OK'} — ${scripts.length} scripts through the live LimitHit store (${rows} rows written, org dropped)`);
if (failed) process.exit(1);
