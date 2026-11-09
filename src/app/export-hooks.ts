import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
// Commons (D-110): no hash column (bodyHash, Upload.sha256: recomputable, and 64-hex trips INV-34), no reporter identity
// (Report.reporterId, ReportSwarmSignal.reporterIds), no per-person votes (Vote, VoteEvent skipped below).
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  { name: 'Profile', rows: (tx, orgId) => tx.profile.findMany({ where: { orgId }, select: { id: true, userId: true, handle: true, joinedAt: true, bannedUntil: true, isModerator: true, modState: true } }) },
  { name: 'Board', rows: (tx, orgId) => tx.board.findMany({ where: { orgId }, select: { id: true, slug: true, title: true, description: true } }) },
  { name: 'Post', rows: (tx, orgId) => tx.post.findMany({ where: { orgId }, select: { id: true, boardId: true, authorId: true, publicId: true, title: true, body: true, createdAt: true, editedAt: true, status: true, ups: true, downs: true, commentCount: true, lockedAt: true, pinnedAt: true } }) },
  { name: 'Comment', rows: (tx, orgId) => tx.comment.findMany({ where: { orgId }, select: { id: true, postId: true, parentId: true, authorId: true, publicId: true, path: true, depth: true, body: true, createdAt: true, editedAt: true, status: true, ups: true, downs: true } }) },
  { name: 'EditHistory', rows: (tx, orgId) => tx.editHistory.findMany({ where: { orgId }, select: { id: true, nodeKind: true, nodeId: true, editorId: true, previousBody: true, editedAt: true, withinWindow: true } }) },
  { name: 'Report', rows: (tx, orgId) => tx.report.findMany({ where: { orgId }, select: { id: true, nodeKind: true, nodeId: true, reason: true, detail: true, createdAt: true } }) },
  { name: 'ModerationCase', rows: (tx, orgId) => tx.moderationCase.findMany({ where: { orgId }, select: { id: true, nodeKind: true, nodeId: true, state: true, openedAt: true, resolvedAt: true } }) },
  { name: 'ModerationAction', rows: (tx, orgId) => tx.moderationAction.findMany({ where: { orgId }, select: { id: true, actorId: true, kind: true, nodeKind: true, nodeId: true, subjectId: true, fromState: true, toState: true, reason: true, until: true, createdAt: true, seq: true } }) },
  { name: 'BrigadeSignal', rows: (tx, orgId) => tx.brigadeSignal.findMany({ where: { orgId }, select: { id: true, kind: true, nodeKind: true, nodeId: true, windowStart: true, voterCount: true, createdAt: true, reviewedAt: true } }) },
  { name: 'ReportSwarmSignal', rows: (tx, orgId) => tx.reportSwarmSignal.findMany({ where: { orgId }, select: { id: true, subjectId: true, windowStart: true, reporterCount: true, createdAt: true, reviewedAt: true } }) },
  { name: 'DuplicateSignal', rows: (tx, orgId) => tx.duplicateSignal.findMany({ where: { orgId }, select: { id: true, nodeKind: true, nodeId: true, matchKind: true, matchId: true, createdAt: true, reviewedAt: true } }) },
  { name: 'Upload', rows: (tx, orgId) => tx.upload.findMany({ where: { orgId }, select: { id: true, profileId: true, postId: true, mime: true, bytes: true, alt: true, createdAt: true } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {
  Vote: 'who voted what is private; Post/Comment ups and downs carry the totals',
  VoteEvent: 'per-person vote log, private like Vote',
  RankSnapshot: 'derived ranking cache, rebuilt by the cron from posts, comments and votes',
  LimitHit: 'rate-limit ledger, swept after the longest window; operational, not org data',
};
