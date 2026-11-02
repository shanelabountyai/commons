// Phase 4 (4.1/4.2/4.5): the two state machines as data, the append-only moderation log, reports → case → queue,
// remove→restore keeps both rows (Handhold's test, D-19), brigade and duplicate signals in the queue, thread lock.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { submitComment, submitEdit, submitPost, submitVote } from '@/forum/actions';
import { toDate } from '@/forum/db';
import { actOnContent, actOnThread, actOnUser, authorHistory, editHistoryFor, queue, reviewSignal, setModerator, submitReport, type ModeratorCtx } from '@/forum/moderation';
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

/** A member joined at `joinedAt`; `contributions` seeded posts (default: 6 historical ones, mature). An explicit count places them just after joining (5.2 tests). */
async function profile(handle: string, joinedAt: number, extra: { isModerator?: boolean } = {}, contributions?: number) {
  const user = await db.user.create({ data: { email: `${handle}-${orgId.slice(0, 8)}@example.com` } });
  await db.membership.create({ data: { orgId, userId: user.id, role: 'member' } });
  const p = await db.profile.create({ data: { orgId, userId: user.id, handle, joinedAt: toDate(joinedAt), ...extra } });
  const n = contributions ?? 6;
  for (let i = 0; i < n; i++) await db.post.create({ data: { orgId, boardId, authorId: p.id, publicId: `${handle}-h${i}`, title: 'h', body: 'h', createdAt: toDate(contributions === undefined ? T0 - (40 - i) * DAY : joinedAt + 60 * (i + 1)) } });
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
    await expect(tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'spam', at: T0 + 11 }, limits, mod))).rejects.toMatchObject({ code: 'ALREADY_REPORTED' }); // 4.1.14: its own code since the patch
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

  it('5.4 A (found by the e2e sweep): a copy posted inside the same epoch second as its original is still a duplicate', async () => {
    const at = T0 + 3 * 3600; // D-7 clocks are whole seconds; the first version's window ended strictly before `at`
    const body = 'two copies of this body land in the very same second, on purpose';
    await tx((t) => submitPost(t, { orgId, profileId: P.reporter!, boardId, publicId: 'M-P10', title: 't', body, at }, limits, mod));
    const dup = await tx((t) => submitPost(t, { orgId, profileId: P.mod!, boardId, publicId: 'M-P11', title: 't', body, at }, limits, mod));
    expect(dup.duplicate).toBe(true);
    expect((await queue(db, orgId)).filter((i) => i.kind === 'DUPLICATE')).toHaveLength(1);
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

  it('4.1.14: a second report by the same member is ALREADY_REPORTED; the detail text reaches the queue item', async () => {
    const post = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P7', title: 't', body: 'a post reported with detail', at: T0 + 900 }, limits, mod));
    await tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'other', detail: 'links to a crypto miner disguised as a NAS script', at: T0 + 901 }, limits, mod));
    await expect(tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'spam', at: T0 + 902 }, limits, mod))).rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
    const item = (await queue(db, orgId, 50)).find((i) => i.kind === 'CASE' && i.node.id === post.id);
    expect(item && item.kind === 'CASE' ? item.reporters.map((r) => r.detail) : null).toEqual(['links to a crypto miner disguised as a NAS script']);
  });

  it('5.4 A: each reporter comes with their handle, join date and how their past reports ended (REMOVED vs CLEARED, last action wins)', async () => {
    const a = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P8', title: 't', body: 'a body the reporter gets right', at: T0 + 2 * 3600 }, limits, mod));
    const b = await tx((t) => submitPost(t, { orgId, profileId: P.author!, boardId, publicId: 'M-P9', title: 't', body: 'a body the reporter gets wrong', at: T0 + 2 * 3600 + 1 }, limits, mod));
    for (const post of [a, b]) await tx((t) => submitReport(t, { orgId, profileId: P.reporter!, node: { kind: 'POST', id: post.id }, reason: 'spam', at: T0 + 2 * 3600 + 2 }, limits, mod));
    await tx((t) => actOnContent(t, modCtx('mod'), 'REMOVE', { kind: 'POST', id: a.id }, 'spam indeed', T0 + 2 * 3600 + 3, mod));
    await tx((t) => actOnContent(t, modCtx('mod'), 'CLEAR', { kind: 'POST', id: b.id }, 'not spam', T0 + 2 * 3600 + 4, mod));
    const p7 = await db.post.findFirstOrThrow({ where: { publicId: 'M-P7' } });
    const item = (await queue(db, orgId)).find((i) => i.kind === 'CASE' && i.node.id === p7.id); // no limit: every open item
    const r = item && item.kind === 'CASE' ? item.reporters[0]! : null;
    expect(r?.handle).toBe('reporter');
    expect(r?.joinedAt).toEqual(toDate(T0 - 400 * DAY));
    // M-P1 was removed then restored (counts for neither); M-P8 ended REMOVED, M-P9 CLEARED; the open ones count for neither
    expect([r?.removed, r?.cleared]).toEqual([1, 1]);
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

describe('who moderates the moderators (4.1.11, D-48, D-14)', () => {
  it('a banned moderator cannot act; a moderator cannot act on a moderator; an owner can; grants and revokes are logged', async () => {
    const owner = await profile('owner1', T0 - 400 * DAY);
    await db.membership.updateMany({ where: { orgId, user: { email: { startsWith: 'owner1-' } } }, data: { role: 'owner' } });
    const ownerCtx: ModeratorCtx = { orgId, profileId: owner, role: 'owner', isModerator: false };
    const mod2 = await profile('mod2', T0 - 400 * DAY);
    // only an owner/admin grants; the grant is a logged action with both states
    await expect(tx((t) => setModerator(t, modCtx('mod'), mod2, true, 'helpful', T0 + 800))).rejects.toMatchObject({ code: 'NOT_MODERATOR' });
    await tx((t) => setModerator(t, ownerCtx, mod2, true, 'helpful in #help', T0 + 801));
    expect((await db.profile.findUniqueOrThrow({ where: { id: mod2 } })).isModerator).toBe(true);
    expect(await db.moderationAction.findFirst({ where: { subjectId: mod2, kind: 'GRANT_MOD' } })).toMatchObject({ fromState: 'MEMBER', toState: 'MODERATOR' });
    // a moderator may not warn or ban another moderator; the owner may
    await expect(tx((t) => actOnUser(t, modCtx('mod'), 'WARN', mod2, 'x', T0 + 802, mod))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect((await tx((t) => actOnUser(t, ownerCtx, 'WARN', mod2, 'tone', T0 + 803, mod))).to).toBe('WARNED');
    // a banned moderator is refused BANNED_UNTIL before anything else
    const ban = await tx((t) => actOnUser(t, ownerCtx, 'BAN', mod2, 'repeat', T0 + 804, mod, 24));
    const mod2Ctx: ModeratorCtx = { orgId, profileId: mod2, role: 'member', isModerator: true };
    const post = await db.post.findFirstOrThrow({ where: { orgId, authorId: P.author! } });
    await expect(tx((t) => actOnContent(t, mod2Ctx, 'REMOVE', { kind: 'POST', id: post.id }, 'x', T0 + 805, mod))).rejects.toMatchObject({ code: 'BANNED_UNTIL', message: `BANNED_UNTIL: ${ban.until}` });
    await tx((t) => setModerator(t, ownerCtx, mod2, false, 'banned', T0 + 806));
    expect(await db.moderationAction.findFirst({ where: { subjectId: mod2, kind: 'REVOKE_MOD' } })).toMatchObject({ fromState: 'MODERATOR', toState: 'MEMBER' });
    await expect(tx((t) => setModerator(t, ownerCtx, mod2, false, 'twice', T0 + 807))).rejects.toMatchObject({ code: 'INPUT_INVALID' }); // already a member
  });
});

describe('5.2 signals through the real vote path (D-75)', () => {
  it('six young accounts upvoting within 10 min open one RING item; counts are exactly the votes; review is logged', async () => {
    const host = await profile('ring-host', T0 - 400 * DAY);
    const post = await tx((t) => submitPost(t, { orgId, profileId: host, boardId, publicId: 'M-RING', title: 'ring target', body: 'a post six fresh accounts will upvote', at: T0 + 1000 }, limits, mod));
    const ringers: string[] = [];
    for (let i = 0; i < 6; i++) ringers.push(await profile(`ringer${i}`, T0 + 1000 - 2 * 3600, {}, 0));
    for (let i = 0; i < 6; i++) await tx((t) => submitVote(t, { orgId, profileId: ringers[i]!, node: { kind: 'POST', id: post.id }, value: 1, at: T0 + 1010 + i * 30 }, limits));
    const rows = await db.brigadeSignal.findMany({ where: { orgId, nodeId: post.id } });
    expect(rows.map((r) => [r.kind, r.voterCount])).toEqual([['RING', 6]]);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).ups).toBe(7); // author's +1 and six applied upvotes: the signal changed nothing
    const item = (await queue(db, orgId, 50)).find((q) => q.kind === 'BRIGADE' && q.node.id === post.id);
    expect(item && item.kind === 'BRIGADE' ? [item.signal, item.voterCount] : null).toEqual(['RING', 6]);
    await tx((t) => reviewSignal(t, modCtx('mod'), { kind: 'BRIGADE', id: item!.id }, 'six two-hour-old accounts, same ten minutes', T0 + 1300));
    expect(await db.moderationAction.findFirst({ where: { orgId, kind: 'REVIEW_SIGNAL', nodeId: post.id } })).toMatchObject({ reason: expect.stringContaining('RING') });
  });

  it('five gate-passing accounts under 7 days downvoting within 10 min open one AGED_BRIGADE; old accounts do not', async () => {
    const host = await profile('aged-host', T0 - 400 * DAY);
    const host2 = await profile('aged-host2', T0 - 400 * DAY);
    const post = await tx((t) => submitPost(t, { orgId, profileId: host, boardId, publicId: 'M-AGED', title: 'aged target', body: 'a post five week-old accounts will downvote', at: T0 + 2000 }, limits, mod));
    const old = await tx((t) => submitPost(t, { orgId, profileId: host2, boardId, publicId: 'M-AGED-OK', title: 'organic', body: 'a post five old accounts will downvote', at: T0 + 2001 }, limits, mod));
    for (let i = 0; i < 5; i++) {
      const aged = await profile(`aged${i}`, T0 + 2000 - 4 * DAY, {}, 3);
      await tx((t) => submitVote(t, { orgId, profileId: aged, node: { kind: 'POST', id: post.id }, value: -1, at: T0 + 2010 + i * 60 }, limits));
      const vet = await profile(`vet${i}`, T0 - 90 * DAY, {}, 8);
      await tx((t) => submitVote(t, { orgId, profileId: vet, node: { kind: 'POST', id: old.id }, value: -1, at: T0 + 2010 + i * 60 }, limits));
    }
    expect((await db.brigadeSignal.findMany({ where: { orgId, nodeId: post.id } })).map((r) => [r.kind, r.voterCount])).toEqual([['AGED_BRIGADE', 5]]);
    expect(await db.brigadeSignal.count({ where: { orgId, nodeId: old.id } })).toBe(0);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).downs).toBe(5); // counted: a signal is for a human (D-31)
  });
});
