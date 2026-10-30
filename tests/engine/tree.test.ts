// GR-01..GR-12 (brief §4) in TypeScript.
import { describe, expect, it } from 'vitest';
import { ancestorPaths, assignPaths, depthOf, permalink, renderThread, segment, type TreeNode } from '@/tree';

const n = (id: string, parent_id: string, created_at: number, status: TreeNode['status'] = 'visible'): TreeNode => ({ id, post_id: 'p', parent_id, created_at, status });
const byCreated = <T extends TreeNode>(s: readonly T[]) => [...s].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
const mini = [n('a', '', 10), n('b', 'a', 11, 'deleted'), n('c', 'b', 12), n('d', 'a', 13, 'removed'), n('e', 'd', 14, 'deleted'), n('f', '', 9)];

describe('tree engine (task 1.6)', () => {
  it('GR-01/02 segments', () => {
    expect(segment(1)).toBe('000001');
    expect(segment(36)).toBe('000010');
  });
  it('GR-03..06 paths, depth, ancestors', () => {
    const p = assignPaths(mini);
    expect([p.get('f'), p.get('a')]).toEqual(['000001', '000002']);
    expect(p.get('c')).toBe('000002000001000001');
    expect(depthOf(p.get('c')!)).toBe(2);
    expect(ancestorPaths(p.get('c')!)).toEqual([p.get('a'), p.get('b')]);
  });
  it('GR-07..09 D-13 rendering', () => {
    const { rows } = renderThread(mini, byCreated, 1, 6);
    const ids = rows.map((r) => r.id);
    expect(rows.find((r) => r.id === 'b')!.rendered_as).toBe('deleted');
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
    expect([mini.length, rows.length]).toEqual([6, 4]);
  });
  it('GR-10 render cut at depth 6 with continue_thread', () => {
    const chain = Array.from({ length: 9 }, (_, d) => n(`n${d}`, d === 0 ? '' : `n${d - 1}`, d));
    const { rows } = renderThread(chain, byCreated, 1, 6);
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)).toMatchObject({ depth: 6, continue_thread: true });
  });
  it('GR-11/12 pagination', () => {
    const many = Array.from({ length: 120 }, (_, k) => n(`t${String(k).padStart(3, '0')}`, '', k));
    const p2 = renderThread(many, byCreated, 2, 6);
    expect([p2.topLevelShown, p2.rows[0]!.id, p2.rows.length]).toEqual([120, 't050', 50]);
    expect(renderThread(many, byCreated, 3, 6).rows).toHaveLength(20);
  });
  it('T-1 a parent outside the post is TREE_INVALID', () => {
    expect(() => assignPaths([n('x', 'nope', 1)])).toThrow(/TREE_INVALID/);
  });
  it('T-5 permalink: ancestors root-most first, subtree re-rooted', () => {
    const p = assignPaths(mini);
    const { ancestors, rows } = permalink(mini, p, byCreated, 'c', 6);
    expect(ancestors).toEqual(['a', 'b']);
    expect(rows).toEqual([{ id: 'c', depth: 0, rendered_as: 'body', continue_thread: false }]);
    expect(permalink(mini, p, byCreated, 'e', 6).rows).toEqual([]); // a dead leaf renders nothing
  });
});
