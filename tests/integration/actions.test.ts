// Phase 3 database tests: the action door (3.4/3.5), the live gates, and one test per refusal code (3.8).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { deleteOwn, RateLimited, submitComment, submitEdit, submitPost, submitVote } from '@/forum/actions';
import { toDate } from '@/forum/db';
import { guardAndRecord, sweepLimitHits } from '@/forum/limits-store';
import { parseLimitRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const T0 = 1_793_232_000;
const DAY = 86_400;
let orgId: string;
let otherOrgId: string;
let boardId: string;
const P: Record<string, string> = {};

async function profile(handle: string, joinedAt: number, org = orgId) {
  const user = await db.user.create({ data: { email: `${handle}-${org.slice(0, 8)}@example.com` } });
  await db.membership.create({ data: { orgId: org, userId: user.id, role: 'member' } });
  return (P[handle] = (await db.profile.create({ data: { orgId: org, userId: user.id, handle, joinedAt: toDate(joinedAt) } })).id);
}
const tx = <T>(f: (t: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(f);

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "LimitHit", "RankSnapshot", "EditHistory", "BrigadeSignal", "VoteEvent", "Vote", "Comment", "Post", "Board", "Profile" CASCADE`);
  await db.org.deleteMany({ where: { slug: { in: ['actions-test', 'actions-other'] } } });
  orgId = (await makeOrg('actions-test')).id;
  otherOrgId = (await makeOrg('actions-other')).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  await profile('vet', T0 - 400 * DAY); // old account; contributions come from what the tests create
  await profile('kid', T0 - 3600);
  await profile('banned', T0 - 400 * DAY);
  await profile('stranger', T0 - 400 * DAY, otherOrgId);
  await db.profile.update({ where: { id: P.banned! }, data: { bannedUntil: toDate(T0 + DAY) } });
  // the vet has history (L-1: fewer than 5 contributions is young, whatever the account age); seeded as historical rows, not actions
  for (let i = 0; i < 6; i++) await db.post.create({ data: { orgId, boardId, authorId: P.vet!, publicId: `A-H${i}`, title: 'h', body: 'h', createdAt: toDate(T0 - (30 - i) * DAY) } });
});
afterAll(() => db.$disconnect());

describe('the action door', () => {
  it('a vet posts, comments and votes; hits are recorded; a young account hits its lower limits', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-P1', title: 't', body: 'b', at: T0 }, rules));
    await tx((t) => submitComment(t, { orgId, profileId: P.vet!, postId: post.id, parentId: null, publicId: 'A-C1', body: 'c', at: T0 + 1 }, rules));
    await tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: null, publicId: 'A-K1', body: 'c', at: T0 + 2 }, rules));
    await tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: null, publicId: 'A-K2', body: 'c', at: T0 + 3 }, rules));
    await expect(tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: null, publicId: 'A-K3', body: 'c', at: T0 + 4 }, rules))).rejects.toMatchObject({ code: 'RATE_LIMITED', action: 'comment', retryAfter: 58 });
    expect(await db.limitHit.count({ where: { profileId: P.kid!, action: 'comment' } })).toBe(2); // refusals write nothing
    expect(await db.comment.count({ where: { publicId: 'A-K3' } })).toBe(0);
  });
  it('BANNED_UNTIL: a banned profile writes nothing and records no hit', async () => {
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.banned!, boardId, publicId: 'A-B1', title: 't', body: 'b', at: T0 + 10 }, rules))).rejects.toMatchObject({ code: 'BANNED_UNTIL' });
    expect(await db.limitHit.count({ where: { profileId: P.banned! } })).toBe(0);
    // after the ban lifts, the same call succeeds
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.banned!, boardId, publicId: 'A-B2', title: 't', body: 'b', at: T0 + DAY + 1 }, rules))).resolves.toHaveProperty('id');
  });
  it('NOT_MEMBER: a profile from another org is refused before anything else', async () => {
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.stranger!, boardId, publicId: 'A-S1', title: 't', body: 'b', at: T0 + 20 }, rules))).rejects.toMatchObject({ code: 'NOT_MEMBER' });
  });
  it('INPUT_INVALID: a NUL byte in a body is refused at the door, not by Postgres (xss fixture X-37, found by the e2e capstone)', async () => {
    const x37 = (JSON.parse(readFileSync('fixtures/xss/cases.json', 'utf8')) as { cases: { id: string; input: string }[] }).cases.find((c) => c.id === 'X-37')!;
    expect(x37.input).toContain('\u0000');
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-N1', title: 't', body: x37.input, at: T0 + 25 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-N2', title: 'a\u0000b', body: 'b', at: T0 + 26 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('4.1.1: edits go through the same door — a banned author is BANNED_UNTIL, a NUL byte is INPUT_INVALID, a stranger is NOT_MEMBER (D-44, D-53)', async () => {
    const own = await tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-E1', title: 't', body: 'original', at: T0 + 27 }, rules));
    await expect(tx((t) => submitEdit(t, { orgId, editorId: P.vet!, node: { kind: 'POST', id: own.id }, body: 'bad\u0000byte', at: T0 + 28 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(tx((t) => submitEdit(t, { orgId, editorId: P.vet!, node: { kind: 'POST', id: own.id }, body: '', at: T0 + 28 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(tx((t) => submitEdit(t, { orgId, editorId: P.stranger!, node: { kind: 'POST', id: own.id }, body: 'x', at: T0 + 28 }, rules))).rejects.toMatchObject({ code: 'NOT_MEMBER' });
    // the banned member authored a post before the ban (seeded row); editing it now is refused with the lift time
    const theirs = await db.post.create({ data: { orgId, boardId, authorId: P.banned!, publicId: 'A-E2', title: 't', body: 'b', createdAt: toDate(T0 - 2 * DAY) } });
    await expect(tx((t) => submitEdit(t, { orgId, editorId: P.banned!, node: { kind: 'POST', id: theirs.id }, body: 'edited', at: T0 + 29 }, rules))).rejects.toMatchObject({ code: 'BANNED_UNTIL', message: `BANNED_UNTIL: ${T0 + DAY}` });
    const ok = await tx((t) => submitEdit(t, { orgId, editorId: P.vet!, node: { kind: 'POST', id: own.id }, body: 'Edited body, long enough to be hashed for the duplicate detector later', at: T0 + 30 }, rules));
    expect(ok.withinWindow).toBe(true);
    const row = await db.post.findUniqueOrThrow({ where: { id: own.id }, select: { body: true, bodyHash: true } });
    expect(row.body).toMatch(/^Edited body/);
    expect(row.bodyHash).not.toBeNull(); // rehashed on edit so the duplicate detector sees edited bodies
  });

  it('4.1.10: the author deletes their own node — [deleted] in place, subtree, votes and totals kept (D-13); others are NOT_AUTHOR', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-D1', title: 'to delete', body: 'b', at: T0 + 5040 }, rules));
    const c1 = await tx((t) => submitComment(t, { orgId, profileId: P.vet!, postId: post.id, parentId: null, publicId: 'A-D1-C1', body: 'parent comment', at: T0 + 5041 }, rules));
    await tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: c1.id, publicId: 'A-D1-C2', body: 'child stays', at: T0 + 5042 }, rules));
    await tx((t) => submitVote(t, { orgId, profileId: P.kid!, node: { kind: 'COMMENT', id: c1.id }, value: 1, at: T0 + 5043 }, rules));
    await expect(tx((t) => deleteOwn(t, { orgId, profileId: P.kid!, node: { kind: 'COMMENT', id: c1.id }, at: T0 + 5044 }))).rejects.toMatchObject({ code: 'NOT_AUTHOR' });
    await expect(tx((t) => deleteOwn(t, { orgId, profileId: P.stranger!, node: { kind: 'COMMENT', id: c1.id }, at: T0 + 5044 }))).rejects.toMatchObject({ code: 'NOT_MEMBER' });
    await tx((t) => deleteOwn(t, { orgId, profileId: P.vet!, node: { kind: 'COMMENT', id: c1.id }, at: T0 + 5045 }));
    const after = await db.comment.findUniqueOrThrow({ where: { id: c1.id }, include: { children: true } });
    expect(after.status).toBe('deleted');
    expect(after.children).toHaveLength(1); // subtree kept
    expect(await db.vote.count({ where: { nodeKind: 'COMMENT', nodeId: c1.id } })).toBe(2); // author +1 and the kid's vote stay
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).commentCount).toBe(2); // totals still count it
    await expect(tx((t) => deleteOwn(t, { orgId, profileId: P.vet!, node: { kind: 'COMMENT', id: c1.id }, at: T0 + 5046 }))).rejects.toMatchObject({ code: 'INPUT_INVALID' }); // already deleted
    // a reply under a deleted comment is still allowed (D-30 names removed, not deleted)
    await tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: c1.id, publicId: 'A-D1-C3', body: 'reply under deleted', at: T0 + 5100 }, rules));
    await tx((t) => deleteOwn(t, { orgId, profileId: P.vet!, node: { kind: 'POST', id: post.id }, at: T0 + 5101 }));
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('deleted');
  });

  it('INPUT_INVALID: empty title, oversize body', async () => {
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-I1', title: '', body: 'b', at: T0 + 30 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-I2', title: 't', body: 'x'.repeat(50_001), at: T0 + 31 }, rules))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
  it('UNKNOWN_NODE and GATED_DOWNVOTE through the door; the kid can downvote after 24 h and 3 contributions', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.vet!, boardId, publicId: 'A-P2', title: 't', body: 'b', at: T0 + 100 }, rules));
    await expect(tx((t) => submitVote(t, { orgId, profileId: P.vet!, node: { kind: 'POST', id: '00000000-0000-0000-0000-000000000000' }, value: 1, at: T0 + 101 }, rules))).rejects.toMatchObject({ code: 'UNKNOWN_NODE' });
    expect((await tx((t) => submitVote(t, { orgId, profileId: P.kid!, node: { kind: 'POST', id: post.id }, value: -1, at: T0 + 102 }, rules))).outcome).toBe('GATED_DOWNVOTE');
    // 3 contributions exist (A-K1, A-K2 + one more) and 24 h have passed
    await tx((t) => submitComment(t, { orgId, profileId: P.kid!, postId: post.id, parentId: null, publicId: 'A-K4', body: 'c', at: T0 + 200 }, rules));
    expect((await tx((t) => submitVote(t, { orgId, profileId: P.kid!, node: { kind: 'POST', id: post.id }, value: -1, at: T0 + DAY + 3600 }, rules))).outcome).toBe('APPLIED');
  });
  it('RateLimited is a typed error with retryAfter; the sweep drops rows past the longest window', async () => {
    const e = new RateLimited('vote', 7);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toContain('retry after 7 s');
    const before = await db.limitHit.count({ where: { orgId } });
    const swept = await tx((t) => sweepLimitHits(t, T0 + 10 * DAY, rules));
    expect(swept).toBe(before);
    expect(await tx((t) => guardAndRecord(t, { orgId, profileId: P.vet!, action: 'report', at: T0 + 10 * DAY }, rules))).toMatchObject({ verdict: 'allow' });
  });
});
