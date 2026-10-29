// The only writer of Post and Comment rows (CLAUDE.md non-negotiable 2; D-33 moves the writer here from the pure
// src/tree because it must touch Prisma). The path and depth come from src/tree's segment math; the ordinal is the
// creation order among siblings, taken under a per-parent advisory lock so two simultaneous replies get different
// segments (task 2.3). The author's fixed +1 (D-12) is written as a Vote row in the same transaction.
import { segment } from '@/tree';
import { ForumRefused, lockKey, toDate, type Tx } from './db';

export type NewPost = { orgId: string; boardId: string; authorId: string; publicId: string; title: string; body: string; createdAt: number };
export type NewComment = { orgId: string; postId: string; parentId: string | null; authorId: string; publicId: string; body: string; createdAt: number };

export async function createPost(tx: Tx, p: NewPost): Promise<{ id: string }> {
  const at = toDate(p.createdAt);
  const post = await tx.post.create({
    data: { orgId: p.orgId, boardId: p.boardId, authorId: p.authorId, publicId: p.publicId, title: p.title, body: p.body, createdAt: at, ups: 1 },
    select: { id: true },
  });
  await tx.vote.create({ data: { orgId: p.orgId, voterId: p.authorId, nodeKind: 'POST', nodeId: post.id, value: 1, castAt: at } });
  return post;
}

/**
 * T-1: the parent must be a comment of the same post (else TREE_INVALID). D-30: a removed parent takes no new
 * replies (PARENT_REMOVED); a deleted one still does. Ordinal = siblings so far + 1 under the parent's lock.
 */
export async function createComment(tx: Tx, c: NewComment): Promise<{ id: string; path: string; depth: number }> {
  const post = await tx.post.findUnique({ where: { id: c.postId }, select: { id: true, orgId: true } });
  if (!post || post.orgId !== c.orgId) throw new ForumRefused('TREE_INVALID', `post ${c.postId} is not in org ${c.orgId}`);
  let prefix = '';
  if (c.parentId) {
    const parent = await tx.comment.findUnique({ where: { id: c.parentId }, select: { postId: true, path: true, status: true } });
    if (!parent || parent.postId !== c.postId) throw new ForumRefused('TREE_INVALID', `parent ${c.parentId} is not a comment of post ${c.postId}`);
    if (parent.status === 'removed') throw new ForumRefused('PARENT_REMOVED', `parent ${c.parentId} was removed by a moderator`);
    prefix = parent.path;
  }
  await lockKey(tx, `comment-parent:${c.parentId ?? c.postId}`);
  const siblings = await tx.comment.count({ where: { postId: c.postId, parentId: c.parentId } });
  const path = prefix + segment(siblings + 1);
  const depth = path.length / 6 - 1;
  const at = toDate(c.createdAt);
  const row = await tx.comment.create({
    data: { orgId: c.orgId, postId: c.postId, parentId: c.parentId, authorId: c.authorId, publicId: c.publicId, path, depth, body: c.body, createdAt: at, ups: 1 },
    select: { id: true, path: true, depth: true },
  });
  await tx.vote.create({ data: { orgId: c.orgId, voterId: c.authorId, nodeKind: 'COMMENT', nodeId: row.id, value: 1, castAt: at } });
  await tx.post.update({ where: { id: c.postId }, data: { commentCount: { increment: 1 } } }); // D-13: every comment counts
  return row;
}
