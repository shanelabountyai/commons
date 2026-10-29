// User-facing writes (task 3.4/3.5/3.8): the one door Phase 4's pages and API go through. Order, for every action:
// 1. the profile belongs to the org and is not banned (D-14: BANNED_UNTIL stops new writes, existing content stays);
// 2. the sliding-window limit for the action, which records the hit if allowed (RATE_LIMITED carries retryAfter);
// 3. the writer (tree writer or vote path), which applies its own rules (TREE_INVALID, PARENT_REMOVED, V-1..V-4).
// Refusals are typed: ForumRefused for 1 and 3, RateLimited for 2. Nothing is dropped silently.
// The fixture loader does not come through here: a historical bulk load is not a user action.
import { MAX_BODY_CHARS } from '@/render';
import type { LimitRules } from '@/rules';
import { ForumRefused, toEpoch, type Tx } from './db';
import { guardAndRecord } from './limits-store';
import { createComment, createPost } from './tree-write';
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

async function admit(tx: Tx, orgId: string, profileId: string, at: number): Promise<void> {
  const p = await tx.profile.findUnique({ where: { id: profileId }, select: { orgId: true, bannedUntil: true } });
  if (!p || p.orgId !== orgId) throw new ForumRefused('NOT_MEMBER', `profile ${profileId} is not in org ${orgId}`);
  if (p.bannedUntil && toEpoch(p.bannedUntil) > at) throw new ForumRefused('BANNED_UNTIL', String(toEpoch(p.bannedUntil)));
}

function checkText(field: string, value: string, max: number): void {
  if (value.length === 0) throw new ForumRefused('INPUT_INVALID', `${field} is empty`);
  if (value.length > max) throw new ForumRefused('INPUT_INVALID', `${field} is ${value.length} chars; the limit is ${max}`);
}

export type SubmitPost = { orgId: string; profileId: string; boardId: string; publicId: string; title: string; body: string; at: number };
export async function submitPost(tx: Tx, s: SubmitPost, rules: LimitRules): Promise<{ id: string }> {
  await admit(tx, s.orgId, s.profileId, s.at);
  checkText('title', s.title, MAX_TITLE_CHARS);
  checkText('body', s.body, MAX_BODY_CHARS);
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'post', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('post', g.retryAfter);
  return createPost(tx, { orgId: s.orgId, boardId: s.boardId, authorId: s.profileId, publicId: s.publicId, title: s.title, body: s.body, createdAt: s.at });
}

export type SubmitComment = { orgId: string; profileId: string; postId: string; parentId: string | null; publicId: string; body: string; at: number };
export async function submitComment(tx: Tx, s: SubmitComment, rules: LimitRules): Promise<{ id: string; path: string; depth: number }> {
  await admit(tx, s.orgId, s.profileId, s.at);
  checkText('body', s.body, MAX_BODY_CHARS);
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'comment', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('comment', g.retryAfter);
  return createComment(tx, { orgId: s.orgId, postId: s.postId, parentId: s.parentId, authorId: s.profileId, publicId: s.publicId, body: s.body, createdAt: s.at });
}

export type SubmitVote = { orgId: string; profileId: string; node: { kind: 'POST' | 'COMMENT'; id: string }; value: 1 | -1; at: number };
export async function submitVote(tx: Tx, s: SubmitVote, rules: LimitRules): Promise<CastResult> {
  await admit(tx, s.orgId, s.profileId, s.at);
  const g = await guardAndRecord(tx, { orgId: s.orgId, profileId: s.profileId, action: 'vote', at: s.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('vote', g.retryAfter);
  return castVote(tx, { orgId: s.orgId, voterId: s.profileId, node: s.node, value: s.value, castAt: s.at }, rules);
}

