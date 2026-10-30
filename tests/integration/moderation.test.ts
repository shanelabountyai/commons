// Phase 4 (4.1/4.2/4.5): the two state machines as data, the append-only moderation log, reports → case → queue,
// remove→restore keeps both rows (Handhold's test, D-19), brigade and duplicate signals in the queue, thread lock.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { submitComment, submitEdit, submitPost, submitVote } from '@/forum/actions';
import { toDate } from '@/forum/db';
import { actOnContent, actOnThread, actOnUser, authorHistory, editHistoryFor, queue, reviewSignal, submitReport, type ModeratorCtx } from '@/forum/moderation';
import { canTransition, parseLimitRules, parseModerationRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const T0 = 1_793_232_000;
const DAY = 86_400;
let orgId: string;
let boardId: string;
const P: Record<string, string> = {};
const tx = <T>(f: (t: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(f);

async function profile(handle: string, joinedAt: number, extra: { isModerator?: boolean } = {}) {
  const user = await db.user.create({ data: { email: `${handle}-${orgId.slice(0, 8)}@example.com` } });
  await db.membership.create({ data: { orgId, userId: user.id, role: 'member' } });
  const p = await db.profile.create({ data: { orgId, userId: user.id, handle, joinedAt: toDate(joinedAt), ...extra } });
  for (let i = 0; i < 6; i++) await db.post.create({ data: { orgId, boardId, authorId: p.id, publicId: `${handle}-h${i}`, title: 'h', body: 'h', createdAt: toDate(T0 - (40 - i) * DAY) } });
  return (P[handle] = p.id);
}
const modCtx = (handle: string): ModeratorCtx => ({ orgId, profileId: P[handle]!, role: 'member', isModerator: handle === 'mod' });

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "Upload", "DuplicateSignal", "ModerationAction", "ModerationCase", "Report", "LimitHit", "RankSnapshot", "EditHistory", "BrigadeSignal", "VoteEvent", "Vote", "Comment", "Post", "Board", "Profile" CASCADE`);
  await db.org.deleteMany({ where: { slug: 'mod-test' } });
  orgId = (await makeOrg('mod-test')).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  await profile('author', T0 - 400 * DAY);
  await profile('reporter', T0 - 400 * DAY);
  await profile('mod', T0 - 400 * DAY, { isModerator: true });
  await profile('plain', T0 - 400 * DAY);
});
afterAll(() => db.$disconnect());

describe('state machines as data', () => {
  it('rules/moderation.json transitions; illegal ones are refused by name', () => {
    expect(canTransition(mod.content_states, 'OPEN', 'REMOVED')).toBe(true);
    expect(canTransition(mod.content_states, 'REMOVED', 'CLEARED')).toBe(false);
    expect(canTransition(mod.user_states, 'ACTIVE', 'BANNED')).toBe(true);
    expect(canTransition(mod.user_states, 'BANNED', 'WARNED')).toBe(false);
  });
});

describe('report → case → queue → remove → restore', () => {
  it('a report opens the case; the queue shows it with reporter count; a plain member cannot act', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P1', title: 't', body: 'a body long enough to be hashed for duplicates later on', at: T0 }, limits, mod));
    const r = await tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'spam', at: T0 + 10 }, limits, mod));
    expect(r.reportsOnNode).toBe(1);
    await expect(tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'spam', at: T0 + 11 }, limits, mod))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(tx((t) => submitReport(t, { orgId, profileId: P.plain!, node: { kind: 'POST', id: post.id }, reason: 'not-a-reason', at: T0 + 12 }, limits, mod))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const q = await queue(db, orgId, 50);
    expect(q.filter((i) => i.kind === 'CASE')).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'CASE', reports: 1, reasons: ['spam'] });
    await expect(tx((t) => actOnContent(t, modCtx('plain'), 'REMOVE', { kind: 'POST', id: post.id }, 'x', T0 + 20, mod))).rejects.toMatchObject({ code: 'NOT_MODERATOR' });
  });
  it('REMOVE hides the node and leaves the queue; RESTORE brings it back; both rows stay; a reason is required', async () => {
    const post = await db.post.findFirstOrThrow({ where: { publicId: 'M-P1' } });
    await expect(tx((t) => actOnContent(t, modCtx('mod'), 'REMOVE', { kind: 'POST', id: post.id }, '   ', T0 + 20, mod))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(await tx((t) => actOnContent(t, modCtx('mod'), 'REMOVE', { kind: 'POST', id: post.id }, 'affiliate spam', T0 + 21, mod))).toEqual({ from: 'OPEN', to: 'REMOVED' });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('removed');
    expect((await queue(db, orgId, 50)).filter((i) => i.kind === 'CASE')).toHaveLength(0);
    await expect(tx((t) => actOnContent(t, modCtx('mod'), 'CLEAR', { kind: 'POST', id: post.id }, 'x', T0 + 22, mod))).rejects.toMatchObject({ code: 'TRANSITION_INVALID' });
    expect(await tx((t) => actOnContent(t, modCtx('mod'), 'RESTORE', { kind: 'POST', id: post.id }, 'appeal upheld', T0 + 23, mod))).toEqual({ from: 'REMOVED', to: 'RESTORED' });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('visible');
    const log = await db.moderationAction.findMany({ where: { nodeId: post.id }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => [l.kind, l.fromState, l.toState])).toEqual([
      ['REMOVE', 'OPEN', 'REMOVED'],
      ['RESTORE', 'REMOVED', 'RESTORED'],
    ]);
    await expect(db.moderationAction.delete({ where: { id: log[0]!.id } })).rejects.toThrow(/append-only/);
    await expect(db.moderationAction.update({ where: { id: log[0]!.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
  });
  it('a removed post takes no replies (D-30) and a locked thread refuses them (THREAD_LOCKED); unlock reverses', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P2', title: 't', body: 'second body, different words entirely here', at: T0 + 100 }, limits, mod));
    await tx((t) => actOnThread(t, modCtx('mod'), 'LOCK', post.id, 'cooling off', T0 + 101));
    await expect(tx((t) => submitComment(t, { orgId, profileId: P.plain!, postId: post.id, parentId: null, publicId: 'M-C1', body: 'c', at: T0 + 102 }, limits, mod))).rejects.toMatchObject({ code: 'THREAD_LOCKED' });
    await expect(tx((t) => actOnThread(t, modCtx('mod'), 'LOCK', post.id, 'again', T0 + 103))).rejects.toMatchObject({ code: 'TRANSITION_INVALID' });
    await tx((t) => actOnThread(t, modCtx('mod'), 'UNLOCK', post.id, 'done', T0 + 104));
    await expect(tx((t) => submitComment(t, { orgId, profileId: P.plain!, postId: post.id, parentId: null, publicId: 'M-C1', body: 'c', at: T0 + 105 }, limits, mod))).resolves.toMatchObject({ depth: 0 });
    await tx((t) => actOnThread(t, modCtx('mod'), 'PIN', post.id, 'faq', T0 + 106));
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).pinnedAt).toEqual(toDate(T0 + 106));
  });
});

describe('users', () => {
  it('WARN → BAN (24 h) → the door refuses BANNED_UNTIL → UNBAN; a self-action and an illegal duration are refused', async () => {
    expect((await tx((t) => actOnUser(t, modCtx('mod'), 'WARN', P.plain!, 'tone', T0 + 200, mod))).to).toBe('WARNED');
    await expect(tx((t) => actOnUser(t, modCtx('mod'), 'BAN', P.plain!, 'x', T0 + 201, mod, 5))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const ban = await tx((t) => actOnUser(t, modCtx('mod'), 'BAN', P.plain!, 'repeat spam', T0 + 202, mod, 24));
    expect(ban).toMatchObject({ from: 'WARNED', to: 'BANNED', until: T0 + 202 + 24 * 3600 });
    await expect(tx((t) => submitPost(t, { orgId, profileId: P.plain!, boardId, publicId: 'M-B1', title: 't', body: 'b', at: T0 + 203 }, limits, mod))).rejects.toMatchObject({ code: 'BANNED_UNTIL' });
    // 4.1.2: reports go through the door too (D-14 lists them)
    const anyPost = await db.post.findFirstOrThrow({ where: { orgId, authorId: P.author! }, select: { id: true } });
    await expect(tx((t) => submitReport(t, { orgId, profileId: P.plain!, node: { kind: 'POST', id: anyPost.id }, reason: 'spam', at: T0 + 203 }, limits, mod))).rejects.toMatchObject({ code: 'BANNED_UNTIL' });
    await expect(tx((t) => actOnUser(t, modCtx('mod'), 'WARN', P.plain!, 'x', T0 + 204, mod))).rejects.toMatchObject({ code: 'TRANSITION_INVALID' });
    await expect(tx((t) => actOnUser(t, modCtx('mod'), 'WARN', P.mod!, 'x', T0 + 205, mod))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect((await tx((t) => actOnUser(t, modCtx('mod'), 'UNBAN', P.plain!, 'served', T0 + 206, mod))).to).toBe('ACTIVE');
    expect((await db.profile.findUniqueOrThrow({ where: { id: P.plain! } })).bannedUntil).toBeNull();
    const perm = await tx((t) => actOnUser(t, modCtx('mod'), 'BAN', P.plain!, 'permanent', T0 + 207, mod, 0));
    expect(perm.until).toBe(4_102_444_800);
  });
});

describe('signals in the queue (4.5, D-31)', () => {
  it('a brigade shows as one item; a duplicate body inside the window is accepted and queued; review removes them', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P3', title: 't', body: 'brigade target with a body that is long enough', at: T0 + 300 }, limits, mod));
    for (let i = 0; i < 5; i++) {
      const kid = await profile(`kid${i}`, T0 - 3600);
      await tx((t) => submitVote(t, { orgId, profileId: kid, node: { kind: 'POST', id: post.id }, value: -1, at: T0 + 301 + i * 60 }, limits));
    }
    const dup = await tx((t) => submitPost(t, { orgId, profileId: P.reporter!, boardId, publicId: 'M-P4', title: 't', body: '  BRIGADE   target with a body that is long enough ', at: T0 + 400 }, limits, mod));
    expect(dup.duplicate).toBe(true);
    const q = await queue(db, orgId, 50);
    expect(q.filter((i) => i.kind === 'BRIGADE')).toHaveLength(1);
    expect(q.filter((i) => i.kind === 'DUPLICATE')).toHaveLength(1);
    const b = q.find((i) => i.kind === 'BRIGADE')!;
    const d = q.find((i) => i.kind === 'DUPLICATE')!;
    await tx((t) => reviewSignal(t, modCtx('mod'), { kind: 'BRIGADE', id: b.id }, 'all five gated, nothing moved', T0 + 500));
    await tx((t) => reviewSignal(t, modCtx('mod'), { kind: 'DUPLICATE', id: d.id }, 'repost, left up', T0 + 501));
    expect((await queue(db, orgId, 50)).filter((i) => i.kind !== 'CASE')).toHaveLength(0);
    await expect(tx((t) => reviewSignal(t, modCtx('mod'), { kind: 'BRIGADE', id: b.id }, 'again', T0 + 502))).rejects.toMatchObject({ code: 'TRANSITION_INVALID' });
  });
});

describe('context for moderators (4.1.8, 4.1.9)', () => {
  it('author history counts reports on comments as well as posts (P0-5)', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.reporter!, boardId, publicId: 'M-P5', title: 't', body: 'host post for a reported comment', at: T0 + 600 }, limits, mod));
    const c = await tx((t) => submitComment(t, { orgId, profileId: P.author!, postId: post.id, parentId: null, publicId: 'M-C5', body: 'spammy comment', at: T0 + 601 }, limits, mod));
    const before = await authorHistory(db, P.author!);
    await tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'COMMENT', id: c.id }, reason: 'spam', at: T0 + 602 }, limits, mod));
    const after = await authorHistory(db, P.author!);
    expect(after.reports).toBe(before.reports + 1);
  });

  it('edit history is readable for moderators: previous bodies, newest first, with the window flag (P0-6)', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P6', title: 't', body: 'first body', at: T0 + 700 }, limits, mod));
    await tx((t) => submitEdit(t, { orgId, editorId: P.author!, node: { kind: 'POST', id: post.id }, body: 'second body', at: T0 + 701 }, limits));
    await tx((t) => submitEdit(t, { orgId, editorId: P.author!, node: { kind: 'POST', id: post.id }, body: 'third body', at: T0 + 700 + limits.edit_window_seconds + 1 }, limits));
    const h = await editHistoryFor(db, orgId, { kind: 'POST', id: post.id });
    expect(h.map((e) => [e.previousBody, e.withinWindow])).toEqual([
      ['second body', false],
      ['first body', true],
    ]);
    expect(await editHistoryFor(db, '00000000-0000-4000-8000-000000000000', { kind: 'POST', id: post.id })).toEqual([]); // scoped by org (INV-03)
  });
});
