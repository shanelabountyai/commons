// Edit windows and history (task 2.7, P0-6, D-32). Only the author edits. Inside the window the node carries no
// mark; at or past it, editedAt is set. Every edit writes the previous body to the append-only EditHistory.
import type { LimitRules } from '@/rules';
import { ForumRefused, nodeInfo, toDate, toEpoch, type NodeRef, type Tx } from './db';

export type EditInput = { orgId: string; editorId: string; node: NodeRef; body: string; at: number };

/** D-32: unmarked iff at − createdAt < edit_window_seconds; an edit at exactly the window is marked. */
export const withinEditWindow = (createdAt: number, at: number, rules: LimitRules): boolean => at - createdAt < rules.edit_window_seconds;

export async function editNode(tx: Tx, input: EditInput, rules: LimitRules): Promise<{ withinWindow: boolean }> {
  const info = await nodeInfo(tx, input.node);
  if (!info || info.orgId !== input.orgId) throw new ForumRefused('UNKNOWN_NODE', `${input.node.kind} ${input.node.id}`);
  if (info.authorId !== input.editorId) throw new ForumRefused('NOT_AUTHOR', `only the author edits ${input.node.kind} ${input.node.id}`);
  const withinWindow = withinEditWindow(toEpoch(info.createdAt), input.at, rules);
  const at = toDate(input.at);
  const previous =
    input.node.kind === 'POST'
      ? (await tx.post.findUniqueOrThrow({ where: { id: input.node.id }, select: { body: true } })).body
      : (await tx.comment.findUniqueOrThrow({ where: { id: input.node.id }, select: { body: true } })).body;
  await tx.editHistory.create({ data: { orgId: input.orgId, nodeKind: input.node.kind, nodeId: input.node.id, editorId: input.editorId, previousBody: previous, editedAt: at, withinWindow } });
  const data = { body: input.body, ...(withinWindow ? {} : { editedAt: at }) };
  if (input.node.kind === 'POST') await tx.post.update({ where: { id: input.node.id }, data });
  else await tx.comment.update({ where: { id: input.node.id }, data });
  return { withinWindow };
}
