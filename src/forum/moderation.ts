// Moderation (Phase 4, task 4.2). Two state machines from rules/moderation.json, moved only here, every move an
// append-only ModerationAction row with actor, reason and the transition (non-negotiable 10's spirit: the log is the
// truth, the state columns are the cache). Who may moderate: owner, admin, or a Profile with isModerator (D-48).
// Removal keeps the subtree (D-13) and refuses new replies beneath (D-30); a ban stops new writes (D-14).
import { canTransition, type LimitRules, type ModerationRules } from '@/rules';
import { admit } from './actions';
import { ForumRefused, lockKey, nodeInfo, toDate, type NodeRef, type Tx } from './db';
import { guardAndRecord } from './limits-store';

export type ModeratorCtx = { orgId: string; profileId: string; role: 'owner' | 'admin' | 'member' | 'scorekeeper'; isModerator: boolean };
export const canModerate = (m: ModeratorCtx): boolean => m.role === 'owner' || m.role === 'admin' || m.isModerator;

export class TransitionInvalid extends Error {
  readonly code = 'TRANSITION_INVALID' as const;
  constructor(
    readonly machine: 'content' | 'user',
    readonly from: string,
    readonly to: string,
  ) {
    super(`TRANSITION_INVALID: ${machine} ${from} → ${to}`);
    this.name = 'TransitionInvalid';
  }
}
export class NotModerator extends Error {
  readonly code = 'NOT_MODERATOR' as const;
  constructor() {
    super('NOT_MODERATOR: owner, admin or a moderator required');
    this.name = 'NotModerator';
  }
}

function requireMod(m: ModeratorCtx): void {
  if (!canModerate(m)) throw new NotModerator();
}
function requireReason(reason: string): string {
  const r = reason.trim();
  if (!r) throw new ForumRefused('INPUT_INVALID', 'a reason is required');
  return r.slice(0, 1000);
}

// ---------------------------------------------------------------------------------------------------- reports

export type SubmitReport = { orgId: string; profileId: string; node: NodeRef; reason: string; detail?: string; at: number };

/** A user reports a node: the `report` window applies (action door rules), one report per reporter per node, and the
 *  first report opens the case (content state OPEN). Reporting your own content is allowed (it still opens a case). */
export async function submitReport(tx: Tx, r: SubmitReport, limits: LimitRules, mod: ModerationRules): Promise<{ caseId: string; reportsOnNode: number }> {
  await admit(tx, r.orgId, r.profileId, r.at); // 4.1.2: a banned member cannot report either (D-14)
  if (!mod.report_reasons.some((x) => x.code === r.reason)) throw new ForumRefused('INPUT_INVALID', `unknown reason ${r.reason}`);
  const info = await nodeInfo(tx, r.node);
  if (!info || info.orgId !== r.orgId) throw new ForumRefused('UNKNOWN_NODE', `${r.node.kind} ${r.node.id}`);
  const g = await guardAndRecord(tx, { orgId: r.orgId, profileId: r.profileId, action: 'report', at: r.at }, limits);
  if (g.verdict === 'refuse') throw Object.assign(new Error(`RATE_LIMITED: report; retry after ${g.retryAfter} s`), { code: 'RATE_LIMITED', action: 'report', retryAfter: g.retryAfter });
  const existing = await tx.report.findUnique({ where: { reporterId_nodeKind_nodeId: { reporterId: r.profileId, nodeKind: r.node.kind, nodeId: r.node.id } } });
  if (existing) throw new ForumRefused('INPUT_INVALID', 'you already reported this');
  await tx.report.create({ data: { orgId: r.orgId, reporterId: r.profileId, nodeKind: r.node.kind, nodeId: r.node.id, reason: r.reason, detail: (r.detail ?? '').slice(0, 2000), createdAt: toDate(r.at) } });
  const c = await openCase(tx, r.orgId, r.node, r.at);
  const reportsOnNode = await tx.report.count({ where: { nodeKind: r.node.kind, nodeId: r.node.id } });
  return { caseId: c.id, reportsOnNode };
}

/** The case for a node, created OPEN if none; a CLEARED/RESTORED case reopens (content_states). */
export async function openCase(tx: Tx, orgId: string, node: NodeRef, at: number): Promise<{ id: string; state: string }> {
  await lockKey(tx, `case:${node.kind}:${node.id}`);
  const c = await tx.moderationCase.findUnique({ where: { nodeKind_nodeId: { nodeKind: node.kind, nodeId: node.id } } });
  if (!c) return tx.moderationCase.create({ data: { orgId, nodeKind: node.kind, nodeId: node.id, state: 'OPEN', openedAt: toDate(at) }, select: { id: true, state: true } });
  if (c.state === 'OPEN' || c.state === 'REMOVED') return c; // already in the queue, or already acted on
  return tx.moderationCase.update({ where: { id: c.id }, data: { state: 'OPEN', openedAt: toDate(at), resolvedAt: null }, select: { id: true, state: true } });
}

// ---------------------------------------------------------------------------------------------------- content

type ContentKind = 'REMOVE' | 'RESTORE' | 'CLEAR' | 'REOPEN';
const CONTENT_TARGET: Record<ContentKind, string> = { REMOVE: 'REMOVED', RESTORE: 'RESTORED', CLEAR: 'CLEARED', REOPEN: 'OPEN' };

/** Moves the node's case through content_states and sets the node's visibility to match; one log row. */
export async function actOnContent(tx: Tx, m: ModeratorCtx, kind: ContentKind, node: NodeRef, reason: string, at: number, mod: ModerationRules): Promise<{ from: string; to: string }> {
  requireMod(m);
  const why = requireReason(reason);
  const info = await nodeInfo(tx, node);
  if (!info || info.orgId !== m.orgId) throw new ForumRefused('UNKNOWN_NODE', `${node.kind} ${node.id}`);
  const c = await openCase(tx, m.orgId, node, at); // REMOVE without a report opens the case first
  const to = CONTENT_TARGET[kind];
  if (!canTransition(mod.content_states, c.state, to)) throw new TransitionInvalid('content', c.state, to);
  const resolved = to === 'REMOVED' || to === 'CLEARED' || to === 'RESTORED';
  await tx.moderationCase.update({ where: { id: c.id }, data: { state: to, resolvedAt: resolved ? toDate(at) : null } });
  const status = to === 'REMOVED' ? 'removed' : to === 'RESTORED' ? 'visible' : undefined;
  if (status) {
    if (node.kind === 'POST') await tx.post.update({ where: { id: node.id }, data: { status } });
    else await tx.comment.update({ where: { id: node.id }, data: { status } });
  }
  await tx.moderationAction.create({ data: { orgId: m.orgId, actorId: m.profileId, kind, nodeKind: node.kind, nodeId: node.id, fromState: c.state, toState: to, reason: why, createdAt: toDate(at) } });
  return { from: c.state, to };
}

/** Lock / unlock a thread (no new replies, D-30's cousin) and pin / unpin a post (P1-1). Logged, not a state machine. */
export async function actOnThread(tx: Tx, m: ModeratorCtx, kind: 'LOCK' | 'UNLOCK' | 'PIN' | 'UNPIN', postId: string, reason: string, at: number): Promise<void> {
  requireMod(m);
  const why = requireReason(reason);
  const p = await tx.post.findUnique({ where: { id: postId }, select: { orgId: true, lockedAt: true, pinnedAt: true } });
  if (!p || p.orgId !== m.orgId) throw new ForumRefused('UNKNOWN_NODE', `POST ${postId}`);
  const from = kind.startsWith('LOCK') || kind.startsWith('UNLOCK') ? (p.lockedAt ? 'LOCKED' : 'UNLOCKED') : p.pinnedAt ? 'PINNED' : 'UNPINNED';
  const to = kind === 'LOCK' ? 'LOCKED' : kind === 'UNLOCK' ? 'UNLOCKED' : kind === 'PIN' ? 'PINNED' : 'UNPINNED';
  if (from === to) throw new TransitionInvalid('content', from, to);
  await tx.post.update({ where: { id: postId }, data: kind === 'LOCK' ? { lockedAt: toDate(at) } : kind === 'UNLOCK' ? { lockedAt: null } : kind === 'PIN' ? { pinnedAt: toDate(at) } : { pinnedAt: null } });
  await tx.moderationAction.create({ data: { orgId: m.orgId, actorId: m.profileId, kind, nodeKind: 'POST', nodeId: postId, fromState: from, toState: to, reason: why, createdAt: toDate(at) } });
}

// ---------------------------------------------------------------------------------------------------- users

/** WARN, BAN (hours from rules.ban_durations_hours; 0 = permanent → until null, modState BANNED, bannedUntil far future), UNBAN. */
export async function actOnUser(tx: Tx, m: ModeratorCtx, kind: 'WARN' | 'BAN' | 'UNBAN', subjectId: string, reason: string, at: number, mod: ModerationRules, hours?: number): Promise<{ from: string; to: string; until: number | null }> {
  requireMod(m);
  const why = requireReason(reason);
  const s = await tx.profile.findUnique({ where: { id: subjectId }, select: { orgId: true, modState: true } });
  if (!s || s.orgId !== m.orgId) throw new ForumRefused('NOT_MEMBER', `profile ${subjectId}`);
  if (subjectId === m.profileId) throw new ForumRefused('INPUT_INVALID', 'moderators do not act on themselves');
  const to = kind === 'WARN' ? 'WARNED' : kind === 'BAN' ? 'BANNED' : 'ACTIVE';
  if (!canTransition(mod.user_states, s.modState, to)) throw new TransitionInvalid('user', s.modState, to);
  let until: number | null = null;
  if (kind === 'BAN') {
    if (hours === undefined || !mod.ban_durations_hours.includes(hours)) throw new ForumRefused('INPUT_INVALID', `ban duration must be one of ${mod.ban_durations_hours.join(', ')} hours (0 = permanent)`);
    until = hours === 0 ? 4_102_444_800 : at + hours * 3600; // 0 → 2100-01-01: "permanent" is a date the door can compare
  }
  await tx.profile.update({ where: { id: subjectId }, data: { modState: to, bannedUntil: kind === 'BAN' ? toDate(until!) : kind === 'UNBAN' ? null : undefined } });
  await tx.moderationAction.create({ data: { orgId: m.orgId, actorId: m.profileId, kind, subjectId, fromState: s.modState, toState: to, reason: why, until: until === null ? null : toDate(until), createdAt: toDate(at) } });
  return { from: s.modState, to, until };
}

/** Mark a brigade or duplicate signal reviewed (it leaves the queue); logged. */
export async function reviewSignal(tx: Tx, m: ModeratorCtx, signal: { kind: 'BRIGADE' | 'DUPLICATE'; id: string }, reason: string, at: number): Promise<void> {
  requireMod(m);
  const why = requireReason(reason);
  const row = signal.kind === 'BRIGADE' ? await tx.brigadeSignal.findUnique({ where: { id: signal.id } }) : await tx.duplicateSignal.findUnique({ where: { id: signal.id } });
  if (!row || row.orgId !== m.orgId) throw new ForumRefused('UNKNOWN_NODE', `${signal.kind} signal ${signal.id}`);
  if (row.reviewedAt) throw new TransitionInvalid('content', 'REVIEWED', 'REVIEWED');
  if (signal.kind === 'BRIGADE') await tx.brigadeSignal.update({ where: { id: signal.id }, data: { reviewedAt: toDate(at) } });
  else await tx.duplicateSignal.update({ where: { id: signal.id }, data: { reviewedAt: toDate(at) } });
  await tx.moderationAction.create({ data: { orgId: m.orgId, actorId: m.profileId, kind: 'REVIEW_SIGNAL', nodeKind: row.nodeKind, nodeId: row.nodeId, fromState: 'UNREVIEWED', toState: 'REVIEWED', reason: `${signal.kind}: ${why}`, createdAt: toDate(at) } });
}

// ---------------------------------------------------------------------------------------------------- queue

export type QueueItem =
  | { kind: 'CASE'; id: string; node: NodeRef; state: string; openedAt: Date; reports: number; reasons: string[] }
  | { kind: 'BRIGADE'; id: string; node: NodeRef; createdAt: Date; voterCount: number }
  | { kind: 'DUPLICATE'; id: string; node: NodeRef; createdAt: Date; match: NodeRef };

/** Open cases, unreviewed brigade signals, unreviewed duplicate signals; oldest first. */
export async function queue(tx: Tx, orgId: string, limit: number): Promise<QueueItem[]> {
  const [cases, brigades, dups] = await Promise.all([
    tx.moderationCase.findMany({ where: { orgId, state: 'OPEN' }, orderBy: { openedAt: 'asc' }, take: limit }),
    tx.brigadeSignal.findMany({ where: { orgId, reviewedAt: null }, orderBy: { createdAt: 'asc' }, take: limit }),
    tx.duplicateSignal.findMany({ where: { orgId, reviewedAt: null }, orderBy: { createdAt: 'asc' }, take: limit }),
  ]);
  const items: QueueItem[] = [];
  for (const c of cases) {
    const reports = await tx.report.findMany({ where: { nodeKind: c.nodeKind, nodeId: c.nodeId }, select: { reason: true } });
    items.push({ kind: 'CASE', id: c.id, node: { kind: c.nodeKind, id: c.nodeId }, state: c.state, openedAt: c.openedAt, reports: reports.length, reasons: [...new Set(reports.map((r) => r.reason))].sort() });
  }
  for (const b of brigades) items.push({ kind: 'BRIGADE', id: b.id, node: { kind: b.nodeKind, id: b.nodeId }, createdAt: b.createdAt, voterCount: b.voterCount });
  for (const d of dups) items.push({ kind: 'DUPLICATE', id: d.id, node: { kind: d.nodeKind, id: d.nodeId }, createdAt: d.createdAt, match: { kind: d.matchKind, id: d.matchId } });
  const when = (i: QueueItem) => (i.kind === 'CASE' ? i.openedAt : i.createdAt).getTime();
  return items.sort((a, b) => when(a) - when(b)).slice(0, limit);
}

/** 4.1.8 (P0-5): the author's history beside a queue item — reports on any of their nodes, posts and comments, and prior actions against them. */
export async function authorHistory(tx: Tx, profileId: string): Promise<{ reports: number; actions: number }> {
  const [posts, comments] = await Promise.all([
    tx.post.findMany({ where: { authorId: profileId }, select: { id: true } }),
    tx.comment.findMany({ where: { authorId: profileId }, select: { id: true } }),
  ]);
  const reports = await tx.report.count({
    where: { OR: [{ nodeKind: 'POST', nodeId: { in: posts.map((p) => p.id) } }, { nodeKind: 'COMMENT', nodeId: { in: comments.map((c) => c.id) } }] },
  });
  return { reports, actions: await tx.moderationAction.count({ where: { subjectId: profileId } }) };
}

/** 4.1.9 (P0-6, D-32): a node's previous bodies for moderators, newest first; scoped by org. The page shows this only to moderators. */
export async function editHistoryFor(tx: Tx, orgId: string, node: NodeRef): Promise<{ previousBody: string; editedAt: Date; withinWindow: boolean; editor: string }[]> {
  const rows = await tx.editHistory.findMany({ where: { orgId, nodeKind: node.kind, nodeId: node.id }, orderBy: { editedAt: 'desc' }, include: { editor: { select: { handle: true } } } });
  return rows.map((r) => ({ previousBody: r.previousBody, editedAt: r.editedAt, withinWindow: r.withinWindow, editor: r.editor.handle }));
}

/** The whole thread's edit history in one read, keyed `${kind}:${id}`, for the thread page's moderator view (4.1.9). */
export async function editHistoryForThread(tx: Tx, orgId: string, postId: string, commentIds: string[]): Promise<Map<string, Awaited<ReturnType<typeof editHistoryFor>>>> {
  const rows = await tx.editHistory.findMany({
    where: { orgId, OR: [{ nodeKind: 'POST', nodeId: postId }, { nodeKind: 'COMMENT', nodeId: { in: commentIds } }] },
    orderBy: { editedAt: 'desc' },
    include: { editor: { select: { handle: true } } },
  });
  const by = new Map<string, Awaited<ReturnType<typeof editHistoryFor>>>();
  for (const r of rows) {
    const k = `${r.nodeKind}:${r.nodeId}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push({ previousBody: r.previousBody, editedAt: r.editedAt, withinWindow: r.withinWindow, editor: r.editor.handle });
  }
  return by;
}
