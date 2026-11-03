// PRD 6.3 (D-89, D-90): a board says what belongs on it. Owner and admin set the description through org.update;
// a member and a moderator-flagged member are refused (the flag is a Profile field, D-48, so the harness cannot see
// it). One line of plain text, at most 300 chars, no control characters; blank clears. The loader writes the six
// seed descriptions and takes titles from fixtures/boards.csv. Red before the code.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { describeBoard } from '@/app/o/[org]/f/actions';
import { loadFixtures } from '@/fixtures/load';
import { toDate } from '@/forum/db';
import { loadForum } from '@/forum/load';
import { boards } from '@/forum/view';
import { parseLimitRules } from '@/rules';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const SLUG = 'boards-test';
let orgId: string;
let boardId: string;
const U: Record<string, string> = {};

const as = async (who: string, description: string) => {
  await actAs(U[who]!, SLUG);
  try {
    return await describeBoard(SLUG, { boardId, description });
  } catch (e) {
    if (e instanceof NavSignal && e.kind === 'redirect') return { redirect: e.to }; // saved: back to the board page
    throw e;
  }
};
const stored = async () => (await db.board.findUniqueOrThrow({ where: { id: boardId } })).description;

beforeAll(async () => {
  await db.org.deleteMany({ where: { slug: { in: [SLUG, `${SLUG}-load`] } } });
  orgId = (await makeOrg(SLUG)).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  for (const role of ['owner', 'admin', 'member'] as const) U[role] = (await addMember(orgId, role, `${role}-${orgId.slice(0, 8)}@example.com`)).id;
  U['mod'] = (await addMember(orgId, 'member', `mod-${orgId.slice(0, 8)}@example.com`)).id;
  await db.profile.create({ data: { orgId, userId: U['mod'], handle: 'mod', joinedAt: toDate(0), isModerator: true } });
});

describe('describeBoard', () => {
  it('an owner sets it; boards() returns it; one audit event with from and to', async () => {
    const r = await as('owner', '  Stuck on something? Say what you tried.  ');
    expect(r).not.toHaveProperty('error');
    expect(await stored()).toBe('Stuck on something? Say what you tried.');
    expect((await boards(orgId)).find((b) => b.id === boardId)?.description).toBe('Stuck on something? Say what you tried.');
    const ev = await db.auditEvent.findMany({ where: { orgId, action: 'forum.board.describe' } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toEqual({ from: '', to: 'Stuck on something? Say what you tried.' });
  });

  it('an admin can', async () => {
    expect(await as('admin', 'Admin wording.')).not.toHaveProperty('error');
    expect(await stored()).toBe('Admin wording.');
  });

  it('a member and a moderator are refused', async () => {
    await expect(as('member', 'member wording')).rejects.toThrow('Missing permission: org.update');
    await expect(as('mod', 'mod wording')).rejects.toThrow('Missing permission: org.update');
    expect(await stored()).toBe('Admin wording.');
  });

  it.each([
    ['301 characters', 'x'.repeat(301), /301 chars; the limit is 300/],
    ['a newline', 'one\ntwo', /control character/],
    ['a NUL', 'one\u0000two', /NUL|control character/],
  ])('refuses %s with INPUT_INVALID', async (_, text, msg) => {
    const r = (await as('owner', text)) as { error?: string };
    expect(r.error).toMatch(/INPUT_INVALID/);
    expect(r.error).toMatch(msg);
    expect(await stored()).toBe('Admin wording.');
  });

  it('300 characters is allowed; blank clears to empty', async () => {
    expect(await as('owner', 'y'.repeat(300))).not.toHaveProperty('error');
    expect(await as('owner', '   ')).not.toHaveProperty('error');
    expect(await stored()).toBe('');
  });
});

describe('loadForum boards', () => {
  it('writes the six descriptions and the boards.csv titles; a second run inserts nothing', async () => {
    const fx = loadFixtures();
    const posts = [...new Map(fx.posts.map((p) => [p.board, p])).values()]; // one post per board
    const authors = new Set(posts.map((p) => p.author));
    const small = { ...fx, users: fx.users.filter((u) => authors.has(u.id)), posts, comments: [], votes: [] };
    const org = await makeOrg(`${SLUG}-load`);
    await db.$transaction((tx) => loadForum(tx, org.id, small, rules), { timeout: 60_000 });
    const bs = await db.board.findMany({ where: { orgId: org.id }, orderBy: { slug: 'asc' } });
    expect(bs.map((b) => [b.slug, b.title])).toEqual(fx.boards.map((b) => [b.slug, b.title]).sort());
    expect(bs.every((b) => b.description.length > 0 && b.description.length <= 300)).toBe(true);
    await db.$transaction((tx) => loadForum(tx, org.id, small, rules), { timeout: 60_000 });
    expect(await db.board.count({ where: { orgId: org.id } })).toBe(6);
  });
});
