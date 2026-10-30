'use server';
// Forum server actions (task 4.3): each is an orgAction (guard → parse → body) whose body goes through the action
// door or the moderation module, inside one transaction, with the template's audit log written alongside. Every
// refusal the door raises becomes the form's { error } with the typed code in the message (brief §3b, task 3.8).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import type { OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { RateLimited, submitComment, submitPost, submitVote } from '@/forum/actions';
import { ForumRefused } from '@/forum/db';
import { editNode } from '@/forum/edit';
import { actOnContent, actOnThread, actOnUser, NotModerator, reviewSignal, submitReport, TransitionInvalid } from '@/forum/moderation';
import { ensureProfile, nowEpoch } from '@/forum/view';
import { parseLimitRules, parseModerationRules } from '@/rules';

const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));

/** The door's typed refusals, said plainly. The code stays in the text so a tester can grep for it. */
function refused(e: unknown): never {
  if (e instanceof RateLimited) throw new Refused(`Slow down: too many ${e.action}s. Try again in ${e.retryAfter} s. (RATE_LIMITED)`);
  if (e instanceof ForumRefused) {
    if (e.code === 'UNKNOWN_NODE') notFound(); // INV-04: not yours ≡ not found
    const why: Record<string, string> = {
      BANNED_UNTIL: 'Your account is banned from posting for now.',
      NOT_MEMBER: 'You are not a member of this forum.',
      INPUT_INVALID: 'Check the form: ' + e.message.replace(/^INPUT_INVALID: /, ''),
      TREE_INVALID: 'That reply target does not belong to this thread.',
      PARENT_REMOVED: 'You cannot reply under a comment a moderator removed.',
      THREAD_LOCKED: 'This thread is locked.',
      NOT_AUTHOR: 'Only the author can edit this.',
      WRITE_ONCE: e.message,
    };
    throw new Refused(`${why[e.code] ?? e.message} (${e.code})`);
  }
  if (e instanceof TransitionInvalid) throw new Refused(`That action is not allowed from the current state: ${e.from} → ${e.to}. (TRANSITION_INVALID)`);
  if (e instanceof NotModerator) throw new Refused('Only moderators can do that. (NOT_MODERATOR)');
  if (e && typeof e === 'object' && (e as { code?: string }).code === 'RATE_LIMITED') throw new Refused(`${(e as Error).message} (RATE_LIMITED)`);
  throw e;
}

const id = () => randomUUID().replace(/-/g, '').slice(0, 12);
const base = (slug: string) => `/o/${slug}/f`;

export const newPost = orgAction(null, z.object({ boardId: ref('board'), title: z.string().min(1).max(300), body: z.string().min(1).max(50_000) }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const board = await db.board.findFirst({ where: { id: i.boardId, orgId: ctx.orgId } });
  if (!board) notFound(); // INV-04
  const publicId = `P-${id()}`;
  try {
    await db.$transaction(async (tx) => {
      const r = await submitPost(tx, { orgId: ctx.orgId, profileId: me.profileId, boardId: board.id, publicId, title: i.title, body: i.body, at: nowEpoch() }, limits, mod);
      await audit(ctx, 'forum.post.created', { targetType: 'post', targetId: r.id, data: { publicId, duplicate: r.duplicate } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  redirect(`${base(ctx.slug)}/p/${publicId}`);
});

export const reply = orgAction(null, z.object({ postId: ref('post'), parentId: ref('comment').optional(), body: z.string().min(1).max(50_000) }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node, postPublicId } = await resolveNode(ctx.orgId, { postId: i.postId, commentId: i.parentId });
  const publicId = `C-${id()}`;
  try {
    await db.$transaction(async (tx) => {
      const r = await submitComment(tx, { orgId: ctx.orgId, profileId: me.profileId, postId: i.postId, parentId: node.kind === 'COMMENT' ? node.id : null, publicId, body: i.body, at: nowEpoch() }, limits, mod);
      await audit(ctx, 'forum.comment.created', { targetType: 'comment', targetId: r.id, data: { publicId, depth: r.depth, duplicate: r.duplicate } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  revalidatePath(`${base(ctx.slug)}/p/${postPublicId}`);
  redirect(`${base(ctx.slug)}/p/${postPublicId}#${publicId}`);
});

/** The target of a node action: the comment when commentId is given, else the post. Row ids (ref) so the invariant
 *  harness can scope them; the post's publicId is read back for the redirect. */
const nodeSchema = z.object({ postId: ref('post'), commentId: ref('comment').optional() });
type NodeInput = z.infer<typeof nodeSchema>;
async function resolveNode(orgId: string, i: NodeInput): Promise<{ node: { kind: 'POST' | 'COMMENT'; id: string }; postPublicId: string }> {
  const post = await db.post.findFirst({ where: { id: i.postId, orgId }, select: { id: true, publicId: true } });
  if (!post) notFound(); // INV-04: not yours ≡ not found
  if (!i.commentId) return { node: { kind: 'POST', id: post.id }, postPublicId: post.publicId };
  const c = await db.comment.findFirst({ where: { id: i.commentId, orgId, postId: post.id }, select: { id: true } });
  if (!c) notFound();
  return { node: { kind: 'COMMENT', id: c.id }, postPublicId: post.publicId };
}

export const vote = orgAction(null, nodeSchema.extend({ value: z.enum(['1', '-1']) }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node, postPublicId } = await resolveNode(ctx.orgId, i);
  let outcome = '';
  try {
    outcome = (await db.$transaction((tx) => submitVote(tx, { orgId: ctx.orgId, profileId: me.profileId, node, value: i.value === '1' ? 1 : -1, at: nowEpoch() }, limits))).outcome;
  } catch (e) {
    refused(e);
  }
  revalidatePath(`${base(ctx.slug)}/p/${postPublicId}`);
  if (outcome === 'GATED_DOWNVOTE') return { notice: 'Recorded, not counted: new accounts cannot downvote yet (24 h and 3 contributions). (GATED_DOWNVOTE)' };
  if (outcome === 'SELF_VOTE') return { notice: 'Your own vote on your own post is fixed. (SELF_VOTE)' };
  redirect(`${base(ctx.slug)}/p/${postPublicId}`);
});

export const edit = orgAction(null, nodeSchema.extend({ body: z.string().min(1).max(50_000) }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node, postPublicId } = await resolveNode(ctx.orgId, i);
  try {
    await db.$transaction(async (tx) => {
      const r = await editNode(tx, { orgId: ctx.orgId, editorId: me.profileId, node, body: i.body, at: nowEpoch() }, limits);
      await audit(ctx, 'forum.edited', { targetType: node.kind.toLowerCase(), targetId: node.id, data: { withinWindow: r.withinWindow } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  redirect(`${base(ctx.slug)}/p/${postPublicId}`);
});

export const report = orgAction(null, nodeSchema.extend({ reason: z.string().min(1), detail: z.string().max(2000).default('') }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node, postPublicId } = await resolveNode(ctx.orgId, i);
  try {
    await db.$transaction(async (tx) => {
      const r = await submitReport(tx, { orgId: ctx.orgId, profileId: me.profileId, node, reason: i.reason, detail: i.detail, at: nowEpoch() }, limits, mod);
      await audit(ctx, 'forum.reported', { targetType: node.kind.toLowerCase(), targetId: node.id, data: { reason: i.reason, reportsOnNode: r.reportsOnNode } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  revalidatePath(`${base(ctx.slug)}/p/${postPublicId}`);
  return { notice: 'Reported. A moderator will look at it.' };
});

// ----------------------------------------------------------------------------------------------- moderation

const modSchema = z.object({ reason: z.string().min(1).max(1000), back: z.string().default('') });

export const moderateContent = orgAction(null, nodeSchema.extend({ ...modSchema.shape, action: z.enum(['REMOVE', 'RESTORE', 'CLEAR', 'REOPEN']) }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node } = await resolveNode(ctx.orgId, i);
  try {
    await db.$transaction(async (tx) => {
      const r = await actOnContent(tx, me, i.action, node, i.reason, nowEpoch(), mod);
      await audit(ctx, `forum.mod.${i.action.toLowerCase()}`, { targetType: node.kind.toLowerCase(), targetId: node.id, data: { from: r.from, to: r.to, reason: i.reason } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  revalidatePath(`${base(ctx.slug)}/mod`);
  redirect(i.back || `${base(ctx.slug)}/mod`);
});

export const moderateThread = orgAction(null, z.object({ postId: ref('post'), action: z.enum(['LOCK', 'UNLOCK', 'PIN', 'UNPIN']), ...modSchema.shape }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const { node, postPublicId } = await resolveNode(ctx.orgId, { postId: i.postId });
  try {
    await db.$transaction(async (tx) => {
      await actOnThread(tx, me, i.action, node.id, i.reason, nowEpoch());
      await audit(ctx, `forum.mod.${i.action.toLowerCase()}`, { targetType: 'post', targetId: node.id, data: { reason: i.reason } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  redirect(`${base(ctx.slug)}/p/${postPublicId}`);
});

export const moderateUser = orgAction(null, z.object({ handle: z.string().min(1), action: z.enum(['WARN', 'BAN', 'UNBAN']), hours: z.string().optional(), ...modSchema.shape }), async (ctx, i) => {
  const me = await ensureProfile(ctx);
  const subject = await db.profile.findUnique({ where: { orgId_handle: { orgId: ctx.orgId, handle: i.handle } }, select: { id: true } });
  if (!subject) throw new Refused('No such member. (NOT_MEMBER)');
  try {
    await db.$transaction(async (tx) => {
      const r = await actOnUser(tx, me, i.action, subject.id, i.reason, nowEpoch(), mod, i.hours === undefined || i.hours === '' ? undefined : Number(i.hours));
      await audit(ctx, `forum.mod.${i.action.toLowerCase()}`, { targetType: 'profile', targetId: subject.id, data: { from: r.from, to: r.to, until: r.until, reason: i.reason } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  redirect(i.back || `${base(ctx.slug)}/u/${i.handle}`);
});

// Two actions, one per signal table, so each id is a ref('<model>') the invariant harness can scope (FR-08).
async function review(ctx: OrgCtx, kind: 'BRIGADE' | 'DUPLICATE', signalId: string, reason: string) {
  const me = await ensureProfile(ctx);
  try {
    await db.$transaction(async (tx) => {
      await reviewSignal(tx, me, { kind, id: signalId }, reason, nowEpoch());
      await audit(ctx, 'forum.mod.review_signal', { targetType: kind.toLowerCase(), targetId: signalId, data: { reason } }, tx);
    });
  } catch (e) {
    refused(e);
  }
  redirect(`${base(ctx.slug)}/mod`);
}
export const reviewBrigade = orgAction(null, z.object({ brigadeSignalId: ref('brigadeSignal'), reason: z.string().min(1).max(1000) }), (ctx, i) => review(ctx, 'BRIGADE', i.brigadeSignalId, i.reason));
export const reviewDuplicate = orgAction(null, z.object({ duplicateSignalId: ref('duplicateSignal'), reason: z.string().min(1).max(1000) }), (ctx, i) => review(ctx, 'DUPLICATE', i.duplicateSignalId, i.reason));
