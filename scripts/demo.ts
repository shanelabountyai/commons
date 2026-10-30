// commons:demo (task 4.8): the three acts of docs/DEMO.md, run against the local `commons` database into a
// fresh org per run (`--org`, default demo-<yyyymmddHHMM>). Every number DEMO.md quotes is printed here.
//   Act 1  the same seed under Hot, Top and New, with rankedAt
//   Act 2  a spam wave from a young account through the real door: allowed / refused / retryAfter, and the duplicate signal
//   Act 3  a brigade of young accounts on one post → one signal in the queue → remove → restore → the append-only log
// Nothing here bypasses the writers: posts, comments, votes and reports go through src/forum/actions and moderation.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { loadFixtures, NOW } from '@/fixtures/load';
import { RateLimited, submitComment, submitPost, submitVote } from '@/forum/actions';
import { toDate } from '@/forum/db';
import { loadForum } from '@/forum/load';
import { actOnContent, queue, reviewSignal, submitReport, type ModeratorCtx } from '@/forum/moderation';
import { recomputeRanks } from '@/forum/rank';
import { boardPosts } from '@/forum/view';
import type { PostSort } from '@/ranking';
import { parseLimitRules, parseModerationRules, parseRankingRules } from '@/rules';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
// A fresh org per run: the append-only trigger also refuses the cascade when an org with log rows is deleted
// (the log outlives the org by design, D-49), so a demo org cannot be rebuilt in place.
const SLUG = arg('--org', `demo-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`);
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const tx = <T>(f: (x: Tx) => Promise<T>) => db.$transaction(f, { timeout: 600_000, maxWait: 10_000 });
const h = (s: string) => console.log(`\n== ${s}`);
const now = Math.floor(Date.now() / 1000);

if (await db.org.findUnique({ where: { slug: SLUG } })) throw new Error(`org ${SLUG} exists; pick another --org (an org with moderation log rows cannot be deleted)`);
const org = await db.org.create({ data: { slug: SLUG, name: `Commons demo (${SLUG})` } });
const t = Date.now();
const report = await tx((x) => loadForum(x, org.id, loadFixtures(), limits));
console.log(`seed: ${report.reduce((n, r) => n + r.inserted, 0)} rows through the writers in ${((Date.now() - t) / 1000).toFixed(1)} s`);

/** A member of the demo org: `ageHours` old with `contributions` prior posts, so the door sees exactly that history. */
async function member(handle: string, ageHours: number, contributions: number, role: 'owner' | 'member' = 'member') {
  const user = await db.user.create({ data: { email: `${handle}@${SLUG}.example.test`, name: handle } });
  await db.membership.create({ data: { orgId: org.id, userId: user.id, role } });
  const p = await db.profile.create({ data: { orgId: org.id, userId: user.id, handle, joinedAt: toDate(now - ageHours * 3600) } });
  const board = (await db.board.findFirst({ where: { orgId: org.id, slug: 'help' } }))!;
  for (let i = 0; i < contributions; i++) await db.post.create({ data: { orgId: org.id, boardId: board.id, authorId: p.id, publicId: `${handle}-prior-${i}`, title: 'prior', body: 'prior', createdAt: toDate(now - ageHours * 3600 + 60 * i) } });
  return p;
}

// ---------------------------------------------------------------------------------------------------------- Act 1
h('Act 1 — the same seed under Hot, Top all time and New (board: selfhosting)');
// ranked at the fixture's eval instant (NOW = T0 + 7 d), the same frame engine:eval and the oracle use; the seed is
// dated around that instant, so wall-clock "now" would put every post in the future
const ranked = await tx((x) => recomputeRanks(x, org.id, NOW, ranking));
console.log(`rank:recompute scored ${ranked.posts} posts and ${ranked.comments} comments at the fixture instant ${new Date(NOW * 1000).toISOString()}`);
for (const sort of ['hot', 'top_all', 'new'] as PostSort[]) {
  const b = (await boardPosts(org.id, 'selfhosting', sort, NOW, ranking))!;
  console.log(`\n${sort.padEnd(8)} (rankedAt ${b.rankedAt?.toISOString() ?? 'live'})`);
  for (const p of b.posts.slice(0, 5)) console.log(`  ${p.publicId.padEnd(12)} net ${String(p.score.net).padStart(4)}  hot ${p.score.hot.toFixed(2).padStart(9)}  age ${Math.round((NOW - p.created_at) / 3600)} h`);
}

// ---------------------------------------------------------------------------------------------------------- Act 2
h('Act 2 — a spam wave from an account 1 hour old (young: comment window young_max 2 / 60 s, post young_max 1 / 3600 s)');
const label = async (items: Awaited<ReturnType<typeof queue>>) =>
  (await Promise.all(items.map(async (i) => {
    const pid = i.node.kind === 'POST' ? (await db.post.findUnique({ where: { id: i.node.id }, select: { publicId: true } }))?.publicId : (await db.comment.findUnique({ where: { id: i.node.id }, select: { publicId: true } }))?.publicId;
    return i.kind === 'BRIGADE' ? `BRIGADE(${i.voterCount} voters) on ${pid}` : i.kind === 'CASE' ? `CASE(${i.reports} report: ${i.reasons.join(',')}) on ${pid}` : `${i.kind} on ${pid}`;
  }))).join(', ') || 'none';
const q0 = await tx((x) => queue(x, org.id, 50));
console.log(`queue before the wave: ${await label(q0)} (the fixture's own brigade, loaded with the seed)`);
const spammer = await member('spammer', 1, 0);
const target = (await db.post.findFirst({ where: { orgId: org.id, publicId: 'P-0001' } }))!;
const wave = { allowed: 0, refused: 0, firstRetry: null as number | null, duplicate: 0 };
for (let i = 0; i < 60; i++) {
  try {
    const r = await tx((x) => submitComment(x, { orgId: org.id, profileId: spammer.id, postId: target.id, parentId: null, publicId: `spam-${i}`, body: `Check out my totally legitimate NAS deal at example.test/deal — limited time, forty characters and more`, at: now - 60 + i }, limits, mod));
    wave.allowed++;
    if (r.duplicate) wave.duplicate++;
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    wave.refused++;
    wave.firstRetry ??= e.retryAfter;
  }
}
console.log(`60 comment attempts in 60 s: allowed ${wave.allowed}, refused ${wave.refused} (RATE_LIMITED), first retryAfter ${wave.firstRetry} s; duplicate signals raised ${wave.duplicate}`);
const posts = { allowed: 0, refused: 0 };
for (let i = 0; i < 5; i++) {
  try {
    await tx((x) => submitPost(x, { orgId: org.id, profileId: spammer.id, boardId: target.boardId, publicId: `spam-post-${i}`, title: `Deal ${i}`, body: 'b', at: now - 50 + i }, limits, mod));
    posts.allowed++;
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    posts.refused++;
  }
}
console.log(`5 post attempts in the same hour: allowed ${posts.allowed}, refused ${posts.refused}`);
const q2 = await tx((x) => queue(x, org.id, 50));
console.log(`queue after the wave: ${await label(q2)} (a duplicate signal is one item however many copies were posted)`);

// ---------------------------------------------------------------------------------------------------------- Act 3
h('Act 3 — a brigade on one post → one signal → remove → restore → the append-only log');
const victim = (await db.post.findFirst({ where: { orgId: org.id, publicId: 'P-GW' } }))!;
const outcomes: Record<string, number> = {};
let signalled = false;
for (let i = 0; i < 7; i++) {
  const b = await member(`brigader-${i}`, 2, 0); // 2 h old, no contributions: below the 24 h / 3-contribution downvote gate
  const r = await tx((x) => submitVote(x, { orgId: org.id, profileId: b.id, node: { kind: 'POST', id: victim.id }, value: -1, at: now - 300 + i * 10 }, limits));
  outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  signalled ||= r.signal;
}
const after = (await db.post.findUnique({ where: { id: victim.id }, select: { ups: true, downs: true } }))!;
console.log(`7 downvotes from 7 accounts 2 h old: outcomes ${JSON.stringify(outcomes)}; P-GW counted downs ${after.downs} (unchanged), ups ${after.ups}; brigade signal raised: ${signalled}`);
const veteran = await member('veteran', 24 * 30, 5);
await tx((x) => submitReport(x, { orgId: org.id, profileId: veteran.id, node: { kind: 'POST', id: victim.id }, reason: 'harassment', at: now - 200 }, limits, mod));
const q3 = await tx((x) => queue(x, org.id, 50));
console.log(`queue: ${await label(q3)}`);
const ownerP = await member('moderator', 24 * 365, 10, 'owner');
const m: ModeratorCtx = { orgId: org.id, profileId: ownerP.id, role: 'owner', isModerator: false };
const brig = q3.find((i) => i.kind === 'BRIGADE' && i.node.id === victim.id)!;
await tx((x) => reviewSignal(x, m, { kind: 'BRIGADE', id: brig.id }, 'seven fresh accounts, same ten minutes', now - 100));
const r1 = await tx((x) => actOnContent(x, m, 'REMOVE', { kind: 'POST', id: victim.id }, 'brigaded; removing pending review', now - 90, mod));
const r2 = await tx((x) => actOnContent(x, m, 'RESTORE', { kind: 'POST', id: victim.id }, 'reviewed: the post is fine, the voters were not', now - 80, mod));
console.log(`moderator: REMOVE ${r1.from}→${r1.to}; RESTORE ${r2.from}→${r2.to}`);
const log = await db.moderationAction.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } });
for (const a of log) console.log(`  ${a.createdAt.toISOString()}  ${a.kind.padEnd(13)} ${a.fromState}→${a.toState}  ${a.reason}`);
let refusedDelete = 'not refused';
try {
  await db.$executeRawUnsafe(`DELETE FROM "ModerationAction" WHERE "orgId" = $1`, org.id);
} catch (e) {
  refusedDelete = /append-only/.test(String(e)) ? 'refused by trigger commons_append_only' : `refused: ${String(e).slice(0, 80)}`;
}
console.log(`DELETE FROM "ModerationAction": ${refusedDelete}; rows still ${await db.moderationAction.count({ where: { orgId: org.id } })}`);
const qEnd = await tx((x) => queue(x, org.id, 50));
console.log(`queue after review: ${await label(qEnd)}`);
console.log(`\nOpen http://localhost:7500/o/${SLUG}/f as an owner of the org to see all of this in the pages.`);
await db.$disconnect();
