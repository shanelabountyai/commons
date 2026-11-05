// User-facing writes (task 3.4/3.5/3.8): the one door Phase 4's pages and API go through. Order, for every action:
// 1. the profile belongs to the org and is not banned (D-14: BANNED_UNTIL stops new writes, existing content stays);
// 2. the sliding-window limit for the action, which records the hit if allowed (RATE_LIMITED carries retryAfter);
// 3. the writer (tree writer or vote path), which applies its own rules (TREE_INVALID, PARENT_REMOVED, V-1..V-4).
// Refusals are typed: ForumRefused for 1 and 3, RateLimited for 2. Nothing is dropped silently.
// The fixture loader does not come through here: a historical bulk load is not a user action.
import { createHash } from 'node:crypto';
import { MAX_BODY_CHARS } from '@/render';
import type { Lockable, LimitRules, ModerationRules } from '@/rules';
import { ForumRefused, nodeInfo, toDate, toEpoch, type NodeRef, type Tx } from './db';
import { guardAndRecord, guardLinks, guardThread } from './limits-store';
import { editNode, type EditInput } from './edit';
import { createComment, createPost, replyDepth } from './tree-write';
import { castVote, type CastResult } from './votes';

export class RateLimited extends Error {
  readonly code = 'RATE_LIMITED' as const;
  constructor(
    readonly action: string,
    readonly retryAfter: number,
  ) {
    super(`RATE_LIMITED: ${action}; retry after ${retryAfter} s`);
    this.name = 'RateLimited';
  }
}

export const MAX_TITLE_CHARS = 300;

/** Step 1 of the door, shared with reports (4.1.2) and moderation checks (4.1.11). */
export async function admit(tx: Tx, orgId: string, profileId: string, at: number): Promise<void> {
  const p = await tx.profile.findUnique({ where: { id: profileId }, select: { orgId: true, bannedUntil: true } });
  if (!p || p.orgId !== orgId) throw new ForumRefused('NOT_MEMBER', `profile ${profileId} is not in org ${orgId}`);
  if (p.bannedUntil && toEpoch(p.bannedUntil) > at) throw new ForumRefused('BANNED_UNTIL', String(toEpoch(p.bannedUntil)));
}

export function checkText(field: string, value: string, max: number): void {
  if (value.length === 0) throw new ForumRefused('INPUT_INVALID', `${field} is empty`);
  if (value.length > max) throw new ForumRefused('INPUT_INVALID', `${field} is ${value.length} chars; the limit is ${max}`);
  // Postgres text cannot hold NUL; without this the write dies with a 500 instead of a refusal (X-37, found by the
  // Phase 4 capstone). Other control characters are left to the renderer, which encodes them.
  if (value.includes('\u0000')) throw new ForumRefused('INPUT_INVALID', `${field} contains a NUL byte`);
}

/** One line of plain text (upload alt, PRD 6.2; board description, PRD 6.3): checkText, and no C0 or DEL control
 *  character, which also refuses newlines. */
export function checkLine(field: string, value: string, max: number): void {
  checkText(field, value, max);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ForumRefused('INPUT_INVALID', `${field} contains a control character`);
}

/** PRD 5.4 B: a lock locks. What it refuses is data (rules/moderation.json lock_refuses); a caller that passes no
 *  moderation rules gets the strictest reading, so a forgotten argument can only refuse more, never less. Checked
 *  before the window, like a ban: a refused write records no hit. Moderator actions do not come through here. */
export async function refuseIfLocked(tx: Tx, orgId: string, node: NodeRef, what: Lockable, mod?: ModerationRules): Promise<void> {
  if (mod && !mod.lock_refuses.includes(what)) return;
  const post =
    node.kind === 'POST'
      ? await tx.post.findUnique({ where: { id: node.id }, select: { orgId: true, lockedAt: true } })
      : (await tx.comment.findUnique({ where: { id: node.id }, select: { post: { select: { orgId: true, lockedAt: true } } } }))?.post;
  if (!post || post.orgId !== orgId) throw new ForumRefused('UNKNOWN_NODE', `${node.kind} ${node.id}`);
  if (post.lockedAt) throw new ForumRefused('THREAD_LOCKED', `locked at ${toEpoch(post.lockedAt)}`);
}

/** Task 4.5: normalised body hash; a match inside the window by a different node is accepted and queued (P1-3). */
export const bodyHash = (body: string): string => createHash('sha256').update(body.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

/** `lte`, not `lt`: clocks are whole seconds (D-7), so a copy posted in the same second as its original is still inside
 *  the window — the e2e sweep posted two in one second and raised nothing (PRD 5.4 A, D-80). `NOT id` keeps a node from matching itself. */
async function duplicateSignal(tx: Tx, orgId: string, node: NodeRef, body: string, at: number, mod?: ModerationRules): Promise<boolean> {
  if (!mod || body.trim().length < mod.duplicate.min_chars) return false;
  const h = bodyHash(body);
  const since = toDate(at - mod.duplicate.window_seconds);
  const [post, comment] = await Promise.all([
    tx.post.findFirst({ where: { orgId, bodyHash: h, createdAt: { gte: since, lte: toDate(at) }, NOT: { id: node.id } }, select: { id: true }, orderBy: { createdAt: 'desc' } }),
    tx.comment.findFirst({ where: { orgId, bodyHash: h, createdAt: { gte: since, lte: toDate(at) }, NOT: { id: node.id } }, select: { id: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const match: NodeRef | null = post ? { kind: 'POST', id: post.id } : comment ? { kind: 'COMMENT', id: comment.id } : null;
  if (!match) return false;
  await tx.duplicateSignal.create({ data: { orgId, nodeKind: node.kind, nodeId: node.id, matchKind: match.kind, matchId: match.id, bodyHash: h, createdAt: toDate(at) } });
  return true;
}

export type SubmitPost = { orgId: string; profileId: string; boardId: string; publicId: string; title: string; body: string; at: number };
export async function submitPost(tx: Tx, s: SubmitPost, rules: LimitRules, mod?: ModerationRules): Promise<{ id: string; duplicate: boolean }> {
  await admit(tx, s.orgId, s.profileId, s.at);
  checkText('title', s.title, MAX_TITLE_CHARS);
  checkText('body', s.body, MAX_BODY_CHARS);
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'post', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('post', g.retryAfter);
  const lk = await guardLinks(tx, { profileId: s.profileId, body: s.body, at: s.at, young: g.young }, rules); // PRD 7.2 (D-100)
  if (lk.verdict === 'refuse') throw new RateLimited('link', lk.retryAfter);
  const row = await createPost(tx, { orgId: s.orgId, boardId: s.boardId, authorId: s.profileId, publicId: s.publicId, title: s.title, body: s.body, createdAt: s.at });
  await tx.post.update({ where: { id: row.id }, data: { bodyHash: bodyHash(s.body) } });
  return { id: row.id, duplicate: await duplicateSignal(tx, s.orgId, { kind: 'POST', id: row.id }, s.body, s.at, mod) };
}

export type SubmitComment = { orgId: string; profileId: string; postId: string; parentId: string | null; publicId: string; body: string; at: number };
export async function submitComment(tx: Tx, s: SubmitComment, rules: LimitRules, mod?: ModerationRules): Promise<{ id: string; path: string; depth: number; duplicate: boolean }> {
  await admit(tx, s.orgId, s.profileId, s.at);
  checkText('body', s.body, MAX_BODY_CHARS);
  await refuseIfLocked(tx, s.orgId, { kind: 'POST', id: s.postId }, 'reply', mod);
  // PRD 6.4 (D-93): too deep is refused before any window, so it spends no slot; then both comment windows
  if ((await replyDepth(tx, s.parentId)) > rules.max_depth_written) throw new ForumRefused('INPUT_INVALID', 'Too deep to reply here; reply higher in the thread');
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'comment', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('comment', g.retryAfter);
  const th = await guardThread(tx, { profileId: s.profileId, postId: s.postId, at: s.at, young: g.young }, rules);
  if (th.verdict === 'refuse') throw new RateLimited('comment', th.retryAfter);
  const lk = await guardLinks(tx, { profileId: s.profileId, body: s.body, at: s.at, young: g.young }, rules); // PRD 7.2 (D-100)
  if (lk.verdict === 'refuse') throw new RateLimited('link', lk.retryAfter);
  const row = await createComment(tx, { orgId: s.orgId, postId: s.postId, parentId: s.parentId, authorId: s.profileId, publicId: s.publicId, body: s.body, createdAt: s.at });
  await tx.comment.update({ where: { id: row.id }, data: { bodyHash: bodyHash(s.body) } });
  return { ...row, duplicate: await duplicateSignal(tx, s.orgId, { kind: 'COMMENT', id: row.id }, s.body, s.at, mod) };
}

/** 4.1.1 (D-64): edits come through the same door as creates — membership and ban, then text checks, then the
 * writer; the body is rehashed so the duplicate detector sees edited bodies. Edits have no sliding window (D-32
 * governs the mark, not a rate). */
export async function submitEdit(tx: Tx, s: EditInput, rules: LimitRules, mod?: ModerationRules): Promise<{ withinWindow: boolean }> {
  await admit(tx, s.orgId, s.editorId, s.at);
  checkText('body', s.body, MAX_BODY_CHARS);
  await refuseIfLocked(tx, s.orgId, s.node, 'edit', mod); // 5.4 B
  const r = await editNode(tx, s, rules);
  const h = bodyHash(s.body);
  if (s.node.kind === 'POST') await tx.post.update({ where: { id: s.node.id }, data: { bodyHash: h } });
  else await tx.comment.update({ where: { id: s.node.id }, data: { bodyHash: h } });
  return r;
}

export type SubmitVote = { orgId: string; profileId: string; node: { kind: 'POST' | 'COMMENT'; id: string }; value: 1 | -1; at: number };
export async function submitVote(tx: Tx, s: SubmitVote, rules: LimitRules, mod?: ModerationRules): Promise<CastResult> {
  await admit(tx, s.orgId, s.profileId, s.at);
  await refuseIfLocked(tx, s.orgId, s.node, 'vote', mod); // 5.4 B
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'vote', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('vote', g.retryAfter);
  return castVote(tx, { orgId: s.orgId, voterId: s.profileId, node: s.node, value: s.value, castAt: s.at }, rules);
}


/** 4.1.10 (D-13): the author deletes their own node. Status → deleted; position, children, vote rows and totals stay;
 * the body is hidden at render, not erased (moderators still see it, P0-6). A member may delete while banned: a ban
 * stops new writes (D-14), and taking your own words down is not one — membership is still required. A node that is
 * already deleted or removed is refused by name. */
export type DeleteOwn = { orgId: string; profileId: string; node: NodeRef; at: number };
export async function deleteOwn(tx: Tx, d: DeleteOwn): Promise<void> {
  const p = await tx.profile.findUnique({ where: { id: d.profileId }, select: { orgId: true } });
  if (!p || p.orgId !== d.orgId) throw new ForumRefused('NOT_MEMBER', `profile ${d.profileId} is not in org ${d.orgId}`);
  const info = await nodeInfo(tx, d.node);
  if (!info || info.orgId !== d.orgId) throw new ForumRefused('UNKNOWN_NODE', `${d.node.kind} ${d.node.id}`);
  if (info.authorId !== d.profileId) throw new ForumRefused('NOT_AUTHOR', `only the author deletes ${d.node.kind} ${d.node.id}`);
  if (info.status !== 'visible') throw new ForumRefused('INPUT_INVALID', `${d.node.kind} is already ${info.status}`);
  if (d.node.kind === 'POST') await tx.post.update({ where: { id: d.node.id }, data: { status: 'deleted' } });
  else await tx.comment.update({ where: { id: d.node.id }, data: { status: 'deleted' } });
}
