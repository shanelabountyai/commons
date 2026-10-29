// Tree engine (brief §2 T-1..T-7, D-13; ADR-001 materialized path). Pure: no clock, no I/O, no database. The only
// module that computes a path, depth or parent (CLAUDE.md non-negotiable 2). Written from the brief, not from
// tools/treelib.py; agreement is proven by GR- tests and engine:eval.
import { InputInvalid } from '@/shared/errors';

export const SEGMENT = 6;
export const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const PAGE_SIZE = 50;

export type Status = 'visible' | 'deleted' | 'removed';
export type TreeNode = { id: string; post_id: string; parent_id: string; created_at: number; status: Status };
export type RenderedAs = 'body' | 'deleted' | 'removed';
export type RenderedRow = { id: string; depth: number; rendered_as: RenderedAs; continue_thread: boolean };
export type SiblingOrder<T extends TreeNode> = (siblings: readonly T[]) => T[];

/** Fixed-width base-36 segment for the 1-based ordinal among siblings. */
export function segment(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal >= 36 ** SEGMENT) throw new InputInvalid('ordinal', `out of range: ${ordinal}`);
  let n = ordinal;
  let out = '';
  while (n > 0) {
    out = ALPHABET[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out.padStart(SEGMENT, '0');
}

export const depthOf = (path: string): number => path.length / SEGMENT - 1;

/** Ancestor paths, root-most first, excluding the node's own path. */
export function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  for (let k = 1; k < path.length / SEGMENT; k++) out.push(path.slice(0, SEGMENT * k));
  return out;
}

const byCreation = (a: TreeNode, b: TreeNode) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Paths for every comment of ONE post (T-1, T-7): the ordinal is the creation order among siblings. A comment whose
 * parent is not in the post is TREE_INVALID.
 */
export function assignPaths(comments: readonly TreeNode[]): Map<string, string> {
  const byParent = new Map<string, TreeNode[]>();
  for (const c of comments) {
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }
  const paths = new Map<string, string>();
  const walk = (parentId: string, prefix: string) => {
    const kids = [...(byParent.get(parentId) ?? [])].sort(byCreation);
    kids.forEach((c, i) => {
      const p = prefix + segment(i + 1);
      paths.set(c.id, p);
      walk(c.id, p);
    });
  };
  walk('', '');
  for (const c of comments) if (!paths.has(c.id)) throw new InputInvalid('TREE_INVALID', `${c.id}: parent ${c.parent_id} is not in post ${c.post_id}`);
  return paths;
}

type Index<T extends TreeNode> = { byId: Map<string, T>; byParent: Map<string, T[]> };

function index<T extends TreeNode>(comments: readonly T[]): Index<T> {
  const byId = new Map<string, T>();
  const byParent = new Map<string, T[]>();
  for (const c of comments) {
    byId.set(c.id, c);
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }
  return { byId, byParent };
}

function hasVisibleDescendant<T extends TreeNode>(id: string, ix: Index<T>): boolean {
  const stack = [...(ix.byParent.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (c.status === 'visible') return true;
    stack.push(...(ix.byParent.get(c.id) ?? []));
  }
  return false;
}

/** D-13: a non-visible node with no visible descendant is omitted from the render (it still counts in totals). */
const shown = <T extends TreeNode>(c: T, ix: Index<T>) => c.status === 'visible' || hasVisibleDescendant(c.id, ix);

/**
 * One page of a thread (T-2..T-6, D-13): top-level comments paged by PAGE_SIZE, each with its subtree to maxDepth;
 * a node at maxDepth with shown children is cut there and flagged continue_thread. `order` sorts siblings.
 */
export function renderThread<T extends TreeNode>(comments: readonly T[], order: SiblingOrder<T>, page: number, maxDepth: number, pageSize = PAGE_SIZE): { rows: RenderedRow[]; topLevelShown: number } {
  if (!Number.isInteger(page) || page < 1) throw new InputInvalid('page', `must be a positive integer, got ${page}`);
  const ix = index(comments);
  const ordered = (parentId: string) => order((ix.byParent.get(parentId) ?? []).filter((c) => shown(c, ix)));
  const top = ordered('');
  const rows: RenderedRow[] = [];
  const emit = (c: T, depth: number) => {
    const kids = ordered(c.id);
    const cont = depth === maxDepth && kids.length > 0;
    rows.push({ id: c.id, depth, rendered_as: c.status === 'visible' ? 'body' : c.status, continue_thread: cont });
    if (!cont) for (const k of kids) emit(k, depth + 1);
  };
  for (const c of top.slice((page - 1) * pageSize, page * pageSize)) emit(c, 0);
  return { rows, topLevelShown: top.length };
}

/** T-5: the node's ancestors (root-most first) and its subtree rendered with the node at depth 0. */
export function permalink<T extends TreeNode>(comments: readonly T[], paths: Map<string, string>, order: SiblingOrder<T>, nodeId: string, maxDepth: number): { ancestors: string[]; rows: RenderedRow[] } {
  const path = paths.get(nodeId);
  if (!path) throw new InputInvalid('node_id', `${nodeId} is not in this thread`);
  const byPath = new Map<string, string>();
  for (const [id, p] of paths) byPath.set(p, id);
  const ancestors = ancestorPaths(path).map((p) => byPath.get(p)!);
  const subtree = comments.filter((c) => paths.get(c.id)!.startsWith(path)).map((c) => (c.id === nodeId ? { ...c, parent_id: '' } : c));
  return { ancestors, rows: renderThread(subtree, order, 1, maxDepth, 1).rows };
}

export const pageCount = (topLevelShown: number, pageSize = PAGE_SIZE): number => Math.ceil(topLevelShown / pageSize);
