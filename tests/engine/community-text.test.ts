// PRD 7.1 (D-98): the additive community text fixture lands on the rates PRD 7.1 §1 fixed before any measurement.
// Written before tools/build_community_text.py. The normal side is invented; these tests pin the generator, not a
// real community.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFixtures, NOW, readFixture } from '@/fixtures/load';
import { parseModerationRules } from '@/rules';

const fx = loadFixtures();
const bodies = readFixture('community/bodies.csv');
const reports = readFixture('community/reports.csv');
const reposts = readFixture('community/reposts.csv');
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const norm = (s: string) => createHash('sha256').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex'); // bodyHash, src/forum/actions.ts
const links = (s: string) => [...s.matchAll(/\]\(https?:\/\/([^/\s)]+)/g)].map((m) => m[1]!);
const text = new Map(bodies.map((b) => [b.node_id!, b]));
const posts = new Map(fx.posts.map((p) => [p.id, p]));
const comments = new Map(fx.comments.map((c) => [c.id, c]));
const users = new Map(fx.users.map((u) => [u.id, u]));
const node = (id: string) => posts.get(id) ?? comments.get(id)!;

describe('fixtures/community (PRD 7.1)', () => {
  it('one row per post and comment, ASCII only', () => {
    expect(bodies).toHaveLength(5_500);
    expect(new Set(text.keys())).toEqual(new Set([...posts.keys(), ...comments.keys()]));
    expect(bodies.every((b) => /^[\x0a\x20-\x7e]*$/.test(b.title! + b.body!))).toBe(true);
  });
  it('post bodies are 200-1,500 chars with a title; comments have no title', () => {
    for (const id of posts.keys()) {
      const b = text.get(id)!;
      expect(b.body!.length, id).toBeGreaterThanOrEqual(200);
      expect(b.body!.length, id).toBeLessThanOrEqual(1_500);
      expect(b.title!.length, id).toBeGreaterThan(0);
    }
    for (const id of comments.keys()) expect(text.get(id)!.title).toBe('');
  });
  it('8 % of comments are short (2-20 chars); the rest are 40-600', () => {
    const lens = [...comments.keys()].map((id) => text.get(id)!.body!.length);
    expect(lens.filter((n) => n >= 2 && n <= 20)).toHaveLength(400);
    expect(lens.filter((n) => n >= 40 && n <= 600)).toHaveLength(4_600);
  });
  it('15 % of posts and 5 % of comments carry one link, every host a fictional .example host (12 at most)', () => {
    const hosts = (ids: Iterable<string>) => [...ids].map((id) => links(text.get(id)!.body!));
    const p = hosts(posts.keys());
    const c = hosts(comments.keys());
    expect(p.filter((h) => h.length === 1)).toHaveLength(75);
    expect(c.filter((h) => h.length === 1)).toHaveLength(250);
    expect([...p, ...c].every((h) => h.length <= 1)).toBe(true);
    const all = new Set([...p, ...c].flat());
    expect(all.size).toBeLessThanOrEqual(12);
    expect([...all].every((h) => h.endsWith('.example'))).toBe(true);
    expect(bodies.every((b) => !/https?:\/\/(?![^/\s)]+\.example[/)\s])/.test(b.body!))).toBe(true);
  });
  it('10 organic reposts: same author, title and body, another board, 1-72 h later', () => {
    expect(reposts).toHaveLength(10);
    for (const r of reposts) {
      const [a, b] = [posts.get(r.original_id!)!, posts.get(r.post_id!)!];
      expect(b.author).toBe(a.author);
      expect(b.board).not.toBe(a.board);
      expect(b.created_at - a.created_at).toBeGreaterThanOrEqual(3_600);
      expect(b.created_at - a.created_at).toBeLessThanOrEqual(72 * 3_600);
      expect(text.get(b.id)!.title).toBe(text.get(a.id)!.title);
      expect(text.get(b.id)!.body).toBe(text.get(a.id)!.body);
    }
    expect(new Set(reposts.flatMap((r) => [r.post_id, r.original_id])).size).toBe(20);
  });
  it('no other title or body (>= duplicate.min_chars) repeats: the reposts are the only duplicates', () => {
    const seen = new Map<string, number>();
    for (const b of bodies) {
      if (b.body!.trim().length >= mod.duplicate.min_chars) seen.set(norm(b.body!), (seen.get(norm(b.body!)) ?? 0) + 1);
      if (b.title) seen.set('t' + norm(b.title), (seen.get('t' + norm(b.title)) ?? 0) + 1);
    }
    expect([...seen.values()].filter((n) => n > 1)).toEqual(Array(20).fill(2));
  });
  it('1 report per 100 nodes plus 1-3 on each removed node, from older non-author accounts', () => {
    const removed = [...fx.posts, ...fx.comments].filter((n) => n.status === 'removed').map((n) => n.id);
    expect(removed).toHaveLength(43);
    expect(reports.length).toBeGreaterThanOrEqual(55 + 43);
    expect(reports.length).toBeLessThanOrEqual(55 + 3 * 43);
    const reported = new Set(reports.map((r) => r.node_id));
    expect(removed.every((id) => reported.has(id))).toBe(true);
    expect(new Set(reports.map((r) => `${r.reporter} ${r.node_id}`)).size).toBe(reports.length);
    const reasons = new Set(mod.report_reasons.map((r) => r.code));
    for (const r of reports) {
      const n = node(r.node_id!);
      const at = Number(r.reported_at);
      expect(reasons.has(r.reason!), r.reason).toBe(true);
      expect(r.reporter).not.toBe(n.author);
      expect(users.get(r.reporter!)!.created_at).toBeLessThan(n.created_at);
      expect(at).toBeGreaterThan(n.created_at);
      expect(at).toBeLessThanOrEqual(NOW);
    }
  });
});
