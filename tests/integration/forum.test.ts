// Phase 2 database tests (tasks 2.2, 2.3, 2.5, 2.7): what the engines cannot prove on their own.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { toDate } from '@/forum/db';
import { editNode, withinEditWindow } from '@/forum/edit';
import { createComment, createPost } from '@/forum/tree-write';
import { castVote, votesVerify } from '@/forum/votes';
import { parseLimitRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const T0 = 1_793_232_000;
const DAY = 86_400;

let orgId: string;
let boardId: string;
const profiles: Record<string, string> = {};

async function profile(handle: string, joinedAt: number) {
  const user = await db.user.create({ data: { email: `${handle}-${orgId.slice(0, 8)}@example.com` } });
  await db.membership.create({ data: { orgId, userId: user.id, role: 'member' } });
  const p = await db.profile.create({ data: { orgId, userId: user.id, handle, joinedAt: toDate(joinedAt) } });
  profiles[handle] = p.id;
  return p.id;
}

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "RankSnapshot", "EditHistory", "BrigadeSignal", "VoteEvent", "Vote", "Comment", "Post", "Board", "Profile" CASCADE`);
  await db.org.deleteMany({ where: { slug: 'forum-test' } });
  orgId = (await makeOrg('forum-test')).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  await profile('alice', T0 - 400 * DAY);
  await profile('bob', T0 - 400 * DAY);
  await profile('kid', T0 - 3600);
  for (let i = 0; i < 6; i++) await profile(`b${i}`, T0 - 3600); // brigade accounts
});
afterAll(() => db.$disconnect());

const post = (author: string, publicId: string, at = T0) => db.$transaction((tx) => createPost(tx, { orgId, boardId, authorId: profiles[author]!, publicId, title: publicId, body: 'b', createdAt: at }));
const comment = (author: string, postId: string, parentId: string | null, publicId: string, at: number) => db.$transaction((tx) => createComment(tx, { orgId, postId, parentId, authorId: profiles[author]!, publicId, body: 'c', createdAt: at }));
const vote = (voter: string, kind: 'POST' | 'COMMENT', id: string, value: 1 | -1, at: number) => db.$transaction((tx) => castVote(tx, { orgId, voterId: profiles[voter]!, node: { kind, id }, value, castAt: at }, rules));

describe('append-only (2.2)', () => {
  it('VoteEvent and EditHistory refuse UPDATE and DELETE', async () => {
    const p = await post('alice', 'P-AO');
    await vote('bob', 'POST', p.id, 1, T0 + 10);
    const ev = await db.voteEvent.findFirstOrThrow({ where: { nodeId: p.id } });
    await expect(db.voteEvent.update({ where: { id: ev.id }, data: { note: 'x' } })).rejects.toThrow(/append-only/);
    await expect(db.voteEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    await db.$transaction((tx) => editNode(tx, { orgId, editorId: profiles.alice!, node: { kind: 'POST', id: p.id }, body: 'edited', at: T0 + 20 }, rules));
    const eh = await db.editHistory.findFirstOrThrow({ where: { nodeId: p.id } });
    await expect(db.editHistory.delete({ where: { id: eh.id } })).rejects.toThrow(/append-only/);
  });
});

describe('tree writer (2.3)', () => {
  it('50 concurrent replies to one parent get 50 distinct ordinals and paths', async () => {
    const p = await post('alice', 'P-CONC');
    const root = await comment('bob', p.id, null, 'C-ROOT', T0 + 1);
    const replies = await Promise.all(Array.from({ length: 50 }, (_, i) => comment(i % 2 ? 'alice' : 'bob', p.id, root.id, `C-R${i}`, T0 + 2 + i)));
    const paths = new Set(replies.map((r) => r.path));
    expect(paths.size).toBe(50);
    expect(replies.every((r) => r.path.startsWith(root.path) && r.depth === 1)).toBe(true);
    const ordinals = [...paths].map((x) => parseInt(x.slice(6), 36)).sort((a, b) => a - b);
    expect(ordinals).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).commentCount).toBe(51);
  });
  it('T-1 a parent from another post is TREE_INVALID; D-30 a removed parent is PARENT_REMOVED, a deleted one is not', async () => {
    const p1 = await post('alice', 'P-T1a');
    const p2 = await post('alice', 'P-T1b');
    const c1 = await comment('bob', p1.id, null, 'C-T1', T0 + 1);
    await expect(comment('bob', p2.id, c1.id, 'C-BAD', T0 + 2)).rejects.toThrow(/TREE_INVALID/);
    await db.comment.update({ where: { id: c1.id }, data: { status: 'removed' } });
    await expect(comment('alice', p1.id, c1.id, 'C-UNDER-REMOVED', T0 + 3)).rejects.toThrow(/PARENT_REMOVED/);
    await db.comment.update({ where: { id: c1.id }, data: { status: 'deleted' } });
    await expect(comment('alice', p1.id, c1.id, 'C-UNDER-DELETED', T0 + 4)).resolves.toMatchObject({ depth: 1 });
  });
});

describe('vote path (2.5)', () => {
  it('one account, one vote: the unique index refuses a second current row even if the path is bypassed', async () => {
    const p = await post('alice', 'P-UNIQ');
    await vote('bob', 'POST', p.id, 1, T0 + 1);
    await expect(db.vote.create({ data: { orgId, voterId: profiles.bob!, nodeKind: 'POST', nodeId: p.id, value: -1, castAt: toDate(T0 + 2) } })).rejects.toThrow(/Unique constraint|unique/i);
    await expect(db.vote.create({ data: { orgId, voterId: profiles.bob!, nodeKind: 'POST', nodeId: p.id, value: 2, castAt: toDate(T0 + 2) } })).rejects.toThrow();
  });
  it('V-1..V-4 live: self vote, toggle, switch, gate; caches track; votes:verify clean', async () => {
    const p = await post('alice', 'P-V');
    expect((await vote('alice', 'POST', p.id, -1, T0 + 1)).outcome).toBe('SELF_VOTE');
    expect((await vote('bob', 'POST', p.id, 1, T0 + 2)).outcome).toBe('APPLIED');
    expect((await vote('bob', 'POST', p.id, 1, T0 + 3)).outcome).toBe('TOGGLED_OFF');
    expect((await vote('bob', 'POST', p.id, 1, T0 + 4)).outcome).toBe('APPLIED');
    expect((await vote('bob', 'POST', p.id, -1, T0 + 5)).outcome).toBe('SWITCHED');
    expect((await vote('kid', 'POST', p.id, -1, T0 + 6)).outcome).toBe('GATED_DOWNVOTE');
    expect((await vote('kid', 'POST', p.id, 1, T0 + 7)).outcome).toBe('APPLIED');
    const row = await db.post.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.ups, row.downs]).toEqual([2, 1]); // alice (author) + kid up; bob down
    const v = await votesVerify(db, orgId);
    expect(v.mismatches).toEqual([]);
  });
  it('D-31: five gated downvotes inside 600 s write one signal; the sixth updates it, not a second', async () => {
    const p = await post('alice', 'P-BRIG');
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await vote(`b${i}`, 'POST', p.id, -1, T0 + 3600 + i * 80));
    expect(results.map((r) => r.signal)).toEqual([false, false, false, false, true, false]);
    const signals = await db.brigadeSignal.findMany({ where: { nodeId: p.id } });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ voterCount: 6, windowStart: toDate(T0 + 3600) });
  });
});

describe('edit windows (2.7, D-32)', () => {
  it('inside the window no mark; at exactly 900 s the mark is set; history keeps every previous body', async () => {
    expect(withinEditWindow(T0, T0 + 899, rules)).toBe(true);
    expect(withinEditWindow(T0, T0 + 900, rules)).toBe(false);
    const p = await post('alice', 'P-EDIT');
    await db.$transaction((tx) => editNode(tx, { orgId, editorId: profiles.alice!, node: { kind: 'POST', id: p.id }, body: 'v2', at: T0 + 899 }, rules));
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).editedAt).toBeNull();
    await db.$transaction((tx) => editNode(tx, { orgId, editorId: profiles.alice!, node: { kind: 'POST', id: p.id }, body: 'v3', at: T0 + 900 }, rules));
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).editedAt).toEqual(toDate(T0 + 900));
    const hist = await db.editHistory.findMany({ where: { nodeId: p.id }, orderBy: { editedAt: 'asc' } });
    expect(hist.map((h) => [h.previousBody, h.withinWindow])).toEqual([
      ['b', true],
      ['v2', false],
    ]);
    await expect(db.$transaction((tx) => editNode(tx, { orgId, editorId: profiles.bob!, node: { kind: 'POST', id: p.id }, body: 'x', at: T0 + 901 }, rules))).rejects.toThrow(/NOT_AUTHOR/);
  });
});
