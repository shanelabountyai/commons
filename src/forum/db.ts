// The forum's database layer, shared by the writers (Phase 2). Not an engine dir: this is where Prisma and the clock
// are allowed. Instants are TIMESTAMPTZ in the database and integer epoch seconds inside the engines (D-7); these
// two helpers are the only conversion.
import type { Prisma } from '@/generated/prisma/client';
import type { NodeKind } from '@/generated/prisma/enums';

export type Tx = Prisma.TransactionClient;
export const toEpoch = (d: Date): number => Math.floor(d.getTime() / 1000);
export const toDate = (epochSeconds: number): Date => new Date(epochSeconds * 1000);

export class ForumRefused extends Error {
  constructor(
    readonly code: 'TREE_INVALID' | 'PARENT_REMOVED' | 'NOT_AUTHOR' | 'UNKNOWN_NODE' | 'NOT_MEMBER' | 'BANNED_UNTIL' | 'WRITE_ONCE' | 'INPUT_INVALID' | 'THREAD_LOCKED' | 'ALREADY_REPORTED',
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ForumRefused';
  }
}

export type NodeRef = { kind: NodeKind; id: string };

/** The node's author and creation instant, or null. Posts and comments are separate tables; nodeKind picks. */
export async function nodeInfo(tx: Tx, ref: NodeRef): Promise<{ authorId: string; createdAt: Date; status: 'visible' | 'deleted' | 'removed'; orgId: string } | null> {
  const row =
    ref.kind === 'POST'
      ? await tx.post.findUnique({ where: { id: ref.id }, select: { authorId: true, createdAt: true, status: true, orgId: true } })
      : await tx.comment.findUnique({ where: { id: ref.id }, select: { authorId: true, createdAt: true, status: true, orgId: true } });
  return row;
}

/** L-5 at an instant: the voter's posts + comments not removed and created before `at`. */
export async function contributionsAt(tx: Tx, profileId: string, at: Date): Promise<number> {
  const [p, c] = await Promise.all([
    tx.post.count({ where: { authorId: profileId, status: { not: 'removed' }, createdAt: { lt: at } } }),
    tx.comment.count({ where: { authorId: profileId, status: { not: 'removed' }, createdAt: { lt: at } } }),
  ]);
  return p + c;
}

/** Serialises writers on one key for the transaction's lifetime (pg_advisory_xact_lock on a 64-bit hash). */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
