// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`. Commons: a profile for the org's user, a board, a post,
// a comment, and one brigade and one duplicate signal (the moderation review action takes a signal id).
import { db } from '@/core/db';

// Fixed ids: the harness generates an action's input once and re-seeds before every call, so rows must come back
// under the same ids each time (the template's own fixtures do the same).
const ID = (key: 'a' | 'b', n: number) => `00000000-0000-4000-8000-${key === 'a' ? '3' : '4'}${String(n).padStart(11, '0')}`;

export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const ids = { profile: ID(key, 1), board: ID(key, 2), post: ID(key, 3), comment: ID(key, 4), brigadeSignal: ID(key, 5), duplicateSignal: ID(key, 6) };
  await db.profile.create({ data: { id: ids.profile, orgId: org.orgId, userId: org.userId, handle: `inv-${key}`, isModerator: true } });
  await db.board.create({ data: { id: ids.board, orgId: org.orgId, slug: `inv-${key}`, title: `Invariant board ${key}` } });
  await db.post.create({ data: { id: ids.post, orgId: org.orgId, boardId: ids.board, authorId: ids.profile, publicId: `P-INV-${key}`, title: 'inv', body: 'inv body' } });
  await db.comment.create({ data: { id: ids.comment, orgId: org.orgId, postId: ids.post, authorId: ids.profile, publicId: `C-INV-${key}`, path: '000001', depth: 0, body: 'inv comment' } });
  await db.brigadeSignal.create({ data: { id: ids.brigadeSignal, orgId: org.orgId, nodeKind: 'POST', nodeId: ids.post, windowStart: new Date(0), voterCount: 5 } });
  await db.duplicateSignal.create({ data: { id: ids.duplicateSignal, orgId: org.orgId, nodeKind: 'POST', nodeId: ids.post, matchKind: 'POST', matchId: ids.post, bodyHash: 'inv' } });
  return ids;
}
