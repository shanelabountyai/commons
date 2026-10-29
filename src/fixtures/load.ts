// Read-only loaders for fixtures/ (task 1.2 shape, D-25). The only place that touches the files; the engines
// take the arrays. Never writes (CLAUDE.md non-negotiable 8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, type CsvRow } from '@/fixtures/csv';
import { InputInvalid } from '@/shared/errors';

export const FIXTURES_DIR = 'fixtures';
export const T0 = 1_793_232_000; // 2026-10-29T00:00:00Z (D-7)
export const NOW = T0 + 7 * 86_400; // eval instant (plan §fixture shape)

export type NodeStatus = 'visible' | 'deleted' | 'removed';
export type User = { id: string; handle: string; created_at: number; banned_until: number | null };
export type Post = { id: string; board: string; author: string; created_at: number; status: NodeStatus };
export type Comment = { id: string; post_id: string; parent_id: string; author: string; created_at: number; status: NodeStatus };
export type VoteEvent = { row: number; voter: string; node_id: string; value: 1 | -1; cast_at: number; note: string };

const int = (row: CsvRow, field: string, file: string): number => {
  const v = row[field];
  if (v === undefined || !/^-?\d+$/.test(v)) throw new InputInvalid(`${file}.${field}`, `not an integer: ${JSON.stringify(v)}`);
  return Number(v);
};
const status = (row: CsvRow, file: string): NodeStatus => {
  const s = row['status'];
  if (s !== 'visible' && s !== 'deleted' && s !== 'removed') throw new InputInvalid(`${file}.status`, `unknown status ${JSON.stringify(s)}`);
  return s;
};

export function readFixture(name: string, dir = FIXTURES_DIR): CsvRow[] {
  return parseCsv(readFileSync(join(dir, name), 'utf8'), name);
}

export function loadFixtures(dir = FIXTURES_DIR) {
  const users: User[] = readFixture('users.csv', dir).map((r) => ({
    id: r['id']!,
    handle: r['handle']!,
    created_at: int(r, 'created_at', 'users.csv'),
    banned_until: r['banned_until'] ? int(r, 'banned_until', 'users.csv') : null,
  }));
  const posts: Post[] = readFixture('posts.csv', dir).map((r) => ({
    id: r['id']!,
    board: r['board']!,
    author: r['author']!,
    created_at: int(r, 'created_at', 'posts.csv'),
    status: status(r, 'posts.csv'),
  }));
  const comments: Comment[] = readFixture('comments.csv', dir).map((r) => ({
    id: r['id']!,
    post_id: r['post_id']!,
    parent_id: r['parent_id'] ?? '',
    author: r['author']!,
    created_at: int(r, 'created_at', 'comments.csv'),
    status: status(r, 'comments.csv'),
  }));
  const votes: VoteEvent[] = readFixture('votes.csv', dir).map((r, i) => {
    const value = int(r, 'value', 'votes.csv');
    if (value !== 1 && value !== -1) throw new InputInvalid('votes.csv.value', `must be 1 or -1, got ${value}`);
    return { row: i + 2, voter: r['voter']!, node_id: r['node_id']!, value, cast_at: int(r, 'cast_at', 'votes.csv'), note: r['note'] ?? '' };
  });
  return { users, posts, comments, votes };
}
export type Fixtures = ReturnType<typeof loadFixtures>;

export const expectedRows = (name: string, dir = FIXTURES_DIR): CsvRow[] => readFixture(name, dir);
