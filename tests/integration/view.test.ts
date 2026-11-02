// PRD 5.1 (D-77): the viewer's own votes, read once per page. Written before myVotes exists (rule 7).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { submitComment, submitPost, submitVote } from '@/forum/actions';
import { toDate } from '@/forum/db';
import { myVotes } from '@/forum/view';
import { parseLimitRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const T0 = 1_793_232_000;
const DAY = 86_400;
let orgId: string;
let otherOrgId: string;
let boardId: string;
const P: Record<string, string> = {};
const tx = <T>(f: (t: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(f);

async function profile(handle: string, org: string) {
  const user = await db.user.create({ data: { email: `${handle}-${org.slice(0, 8)}@example.com` } });
  await db.membership.create({ data: { orgId: org, userId: user.id, role: 'member' } });
  const p = await db.profile.create({ data: { orgId: org, userId: user.id, handle, joinedAt: toDate(T0 - 400 * DAY) } });
  const b = (await db.board.findFirst({ where: { orgId: org } })) ?? (await db.board.create({ data: { orgId: org, slug: 'help', title: 'Help' } }));
  for (let i = 0; i < 6; i++) await db.post.create({ data: { orgId: org, boardId: b.id, authorId: p.id, publicId: `${handle}-h${i}`, title: 'h', body: 'h', createdAt: toDate(T0 - (40 - i) * DAY) } });
  return (P[handle] = p.id);
}

beforeAll(async () => {
  await db.org.deleteMany({ where: { slug: { in: ['view-test', 'view-other'] } } });
  orgId = (await makeOrg('view-test')).id;
  otherOrgId = (await makeOrg('view-other')).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  await profile('author', orgId);
  await profile('voter', orgId);
  await profile('stranger', otherOrgId);
});
afterAll(() => db.$disconnect());

describe('myVotes (5.1)', () => {
  it('returns 1, -1 or 0 per node for the viewer; the author sees their fixed +1; nothing crosses orgs', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'V-P1', title: 't', body: 'b', at: T0 }, limits));
    const c1 = await tx((t) => submitComment(t, { orgId, profileId: P.author!, postId: post.id, parentId: null, publicId: 'V-C1', body: 'c1', at: T0 + 1 }, limits));
    const c2 = await tx((t) => submitComment(t, { orgId, profileId: P.author!, postId: post.id, parentId: null, publicId: 'V-C2', body: 'c2', at: T0 + 2 }, limits));
    await tx((t) => submitVote(t, { orgId, profileId: P.voter!, node: { kind: 'POST', id: post.id }, value: 1, at: T0 + 10 }, limits));
    await tx((t) => submitVote(t, { orgId, profileId: P.voter!, node: { kind: 'COMMENT', id: c1.id }, value: -1, at: T0 + 11 }, limits));
    const nodes = [{ kind: 'POST' as const, id: post.id }, { kind: 'COMMENT' as const, id: c1.id }, { kind: 'COMMENT' as const, id: c2.id }];
    const mine = await myVotes(orgId, P.voter!, nodes);
    expect([mine.get(post.id), mine.get(c1.id), mine.get(c2.id)]).toEqual([1, -1, 0]);
    // toggling off returns to 0 (V-3)
    await tx((t) => submitVote(t, { orgId, profileId: P.voter!, node: { kind: 'POST', id: post.id }, value: 1, at: T0 + 20 }, limits));
    expect((await myVotes(orgId, P.voter!, nodes)).get(post.id)).toBe(0);
    expect((await myVotes(orgId, P.author!, nodes)).get(c2.id)).toBe(1); // D-12: the author's +1 is a vote row
    const foreign = await myVotes(otherOrgId, P.voter!, nodes); // INV-03: the org scopes the read
    expect([...foreign.values()].every((v) => v === 0)).toBe(true);
    expect((await myVotes(orgId, P.voter!, [])).size).toBe(0);
  });
});
