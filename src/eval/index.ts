// The Phase 1 evaluator (task 1.9, D-9, D-25): runs the four engines over fixtures/ and diffs every expected file.
// Pure given the loaded fixtures; scripts/engine-eval.ts does the printing and the exit code. Mirrors the row
// shapes tools/reference_rank.py writes; a difference is a defect in one side, never a reason to edit the file.
import type { CsvRow } from '@/fixtures/csv';
import { NOW, type Fixtures, type LinkCase } from '@/fixtures/load';
import { isYoung, linkHosts, replay, replayComments, replayLinks, type Account, type CommentAttempt, type LinkAttempt } from '@/limits';
import { hot, net, orderPosts, orderSiblings, wilsonLower, type Counts, type PostSort } from '@/ranking';
import type { Action, LimitRules, ModerationRules, RankingRules } from '@/rules';
import { assignPaths, depthOf, pageCount, permalink, renderThread, type TreeNode } from '@/tree';
import { reduceVotes, type Outcome } from '@/votes';
import { detectReportSwarms, type SwarmScenario, type SwarmSignal } from '@/limits/report-swarm';
import { detectSignals, type Signal, type SignalScenario } from '@/votes/signals';

export type Diff = { file: string; row: number; field: string; expected: string; actual: string };
export type FileResult = { file: string; rows: number; matched: number; firstDiff?: Diff };
export type EvalReport = {
  nodes: number;
  visiblePosts: number;
  now: number;
  outcomes: Record<Outcome, number>;
  files: FileResult[];
  limits: { script: string; attempts: number; allowed: number; refused: number; firstRetryAfter: number | null }[];
  threads: { post_id: string; comments_total: number; top_level_shown: number; pages: number }[];
  /** 5.2: every signal the whole community's votes raise (the false-positive check; the oracle finds only P-BRIGADE's). */
  communitySignals: Signal[];
  /** PRD 7.2 (D-100): every REPORT_SWARM the organic reports raise (the oracle, tools/carried_measures.py, finds none). */
  communitySwarms: SwarmSignal[];
};

const POST_SORTS: PostSort[] = ['hot', 'top_day', 'top_week', 'top_all', 'new'];
const NAMED_THREADS = ['P-THICK', 'P-CHAIN', 'P-GW'];
const HOT_TOLERANCE = 1e-7;
const WILSON_TOLERANCE = 5e-5;

export function evaluate(fx: Fixtures, ranking: RankingRules, limits: LimitRules, expected: (name: string) => CsvRow[], now = NOW, signalScenarios: readonly SignalScenario[] = [], swarmScenarios: readonly SwarmScenario[] = [], mod?: ModerationRules): EvalReport {
  const accounts = new Map(fx.users.map((u) => [u.id, u.created_at]));
  const nodes = new Map<string, string>();
  for (const p of fx.posts) nodes.set(p.id, p.author);
  for (const c of fx.comments) nodes.set(c.id, c.author);
  // L-5: contributions = authored posts + comments not removed, created before t
  const authored = new Map<string, number[]>();
  for (const r of [...fx.posts, ...fx.comments]) {
    if (r.status === 'removed') continue;
    const list = authored.get(r.author) ?? [];
    list.push(r.created_at);
    authored.set(r.author, list);
  }
  for (const list of authored.values()) list.sort((a, b) => a - b);
  const contributionsAt = (user: string, t: number): number => {
    const list = authored.get(user) ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const accountAt = (voter: string, t: number): Account => ({ created_at: accounts.get(voter) ?? Number.NEGATIVE_INFINITY, contributions: contributionsAt(voter, t) });

  const { counts, outcomes } = reduceVotes(nodes, fx.votes, accountAt, limits);
  const count = (id: string): Counts => counts.get(id) ?? { ups: 0, downs: 0 };
  const files: FileResult[] = [];
  const compare = (file: string, actual: Record<string, string | number>[], tolerance?: { field: string; eps: number }) => {
    const exp = expected(file);
    const res: FileResult = { file, rows: exp.length, matched: 0 };
    const n = Math.max(exp.length, actual.length);
    for (let i = 0; i < n; i++) {
      const e = exp[i];
      const a = actual[i];
      if (!e || !a) {
        res.firstDiff ??= { file, row: i + 2, field: '(row)', expected: e ? JSON.stringify(e) : '(none)', actual: a ? JSON.stringify(a) : '(none)' };
        continue;
      }
      let ok = true;
      for (const field of Object.keys(e)) {
        const ev = e[field]!;
        const av = String(a[field] ?? '');
        const close = tolerance && field === tolerance.field ? Math.abs(Number(ev) - Number(av)) <= tolerance.eps : ev === av;
        if (!close) {
          ok = false;
          res.firstDiff ??= { file, row: i + 2, field, expected: ev, actual: av };
          break;
        }
      }
      if (ok) res.matched++;
    }
    files.push(res);
  };

  // posts
  const visible = fx.posts.filter((p) => p.status === 'visible');
  for (const sort of POST_SORTS) {
    const ordered = orderPosts(visible, count, sort, now, ranking);
    const score = (p: (typeof visible)[number]) => (sort === 'hot' ? hot(count(p.id), p.created_at, ranking).toFixed(7) : sort === 'new' ? String(p.created_at) : String(net(count(p.id))));
    compare(`expected_post_order_${sort}.csv`, ordered.map((p, i) => ({ rank: i + 1, post_id: p.id, score: score(p) })), sort === 'hot' ? { field: 'score', eps: HOT_TOLERANCE } : undefined);
  }
  // comments: best per parent group, named threads + the three largest generic threads with ≥ 20 comments
  const byPost = new Map<string, typeof fx.comments>();
  for (const c of fx.comments) {
    const list = byPost.get(c.post_id) ?? [];
    list.push(c);
    byPost.set(c.post_id, list);
  }
  const generic = [...byPost.entries()]
    .filter(([pid, cs]) => pid.startsWith('P-0') && cs.length >= 20)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([pid]) => pid);
  const bestOrder = <T extends TreeNode>(s: readonly T[]) => orderSiblings(s, count, 'best', ranking);
  const bestRows: Record<string, string | number>[] = [];
  for (const pid of [...NAMED_THREADS, ...generic]) {
    const groups = new Map<string, typeof fx.comments>();
    for (const c of byPost.get(pid) ?? []) groups.set(c.parent_id, [...(groups.get(c.parent_id) ?? []), c]);
    for (const parent of [...groups.keys()].sort()) {
      bestOrder(groups.get(parent)!).forEach((c, i) => bestRows.push({ post_id: pid, parent_id: parent, rank: i + 1, comment_id: c.id, score: wilsonLower(count(c.id), ranking.best.z).toFixed(7) }));
    }
  }
  compare('expected_comment_order_best.csv', bestRows, { field: 'score', eps: WILSON_TOLERANCE });
  compare(
    'expected_counts.csv',
    [...counts.keys()].sort().map((id) => ({ node_id: id, ups: count(id).ups, downs: count(id).downs })),
  );
  compare(
    'expected_vote_outcomes.csv',
    [...outcomes.entries()].sort((a, b) => a[0] - b[0]).map(([row, outcome]) => {
      const v = fx.votes[row - 2]!;
      return { row, voter: v.voter, node_id: v.node_id, outcome };
    }),
  );
  // trees
  const treeRows: Record<string, string | number>[] = [];
  const threads: EvalReport['threads'] = [];
  for (const [pid, pages] of [
    ['P-CHAIN', [1]],
    ['P-THICK', [1, 2]],
  ] as const) {
    const cs = byPost.get(pid)!;
    const paths = assignPaths(cs);
    let topShown = 0;
    for (const page of pages) {
      const r = renderThread(cs, bestOrder, page, limits.max_depth_rendered);
      topShown = r.topLevelShown;
      for (const row of r.rows) treeRows.push({ post_id: pid, page, id: row.id, depth: row.depth, path: paths.get(row.id)!, rendered_as: row.rendered_as, continue_thread: row.continue_thread ? 1 : 0 });
    }
    threads.push({ post_id: pid, comments_total: cs.length, top_level_shown: topShown, pages: pageCount(topShown) });
  }
  compare('expected_tree.csv', treeRows);
  compare('expected_pages.csv', threads.map((t) => ({ ...t })));
  const permaRows = ['C-CHAIN-7', 'C-THICK-DEEP-11', 'C-DEL-LEAF'].map((nid) => {
    const pid = nid.startsWith('C-THICK') ? 'P-THICK' : 'P-CHAIN';
    const cs = byPost.get(pid)!;
    const r = permalink(cs, assignPaths(cs), bestOrder, nid, limits.max_depth_rendered);
    return { node_id: nid, ancestors: r.ancestors.join('|'), rows: r.rows.length, first_rendered_as: r.rows[0]?.rendered_as ?? 'omitted' };
  });
  compare('expected_permalink.csv', permaRows);
  // limits scripts
  const t0 = now - 3600;
  const scripts: { script: string; action: Action; user: string; attempts: number[] }[] = [
    { script: 'spam-young-comments', action: 'comment', user: 'u193', attempts: Array.from({ length: 60 }, (_, i) => t0 + i) },
    { script: 'spam-young-posts', action: 'post', user: 'u193', attempts: Array.from({ length: 20 }, (_, i) => t0 + 60 * i) },
    { script: 'spam-young-votes', action: 'vote', user: 'u193', attempts: Array.from({ length: 100 }, (_, i) => t0 + i) },
    { script: 'spam-young-uploads', action: 'upload', user: 'u193', attempts: Array.from({ length: 30 }, (_, i) => t0 + 10 * i) }, // PRD 6.2 (D-87)
    { script: 'normal-u050-posts', action: 'post', user: 'u050', attempts: fx.posts.filter((p) => p.author === 'u050').map((p) => p.created_at).sort((a, b) => a - b) },
    { script: 'normal-u050-comments', action: 'comment', user: 'u050', attempts: fx.comments.filter((c) => c.author === 'u050').map((c) => c.created_at).sort((a, b) => a - b) },
    { script: 'normal-u050-votes', action: 'vote', user: 'u050', attempts: fx.votes.filter((v) => v.voter === 'u050').map((v) => v.cast_at).sort((a, b) => a - b) },
  ];
  const limitRows = scripts.map((s) => {
    const r = replay(s.attempts, s.action, { created_at: accounts.get(s.user)!, contributionsAt: (t) => contributionsAt(s.user, t) }, limits);
    return { script: s.script, action: s.action, attempts: s.attempts.length, allowed: r.allowed, refused: r.refused, first_retry_after: r.firstRetryAfter ?? '' };
  });
  const communityComments = [...byPost.entries()].flatMap(([pid, cs]) => {
    const paths = assignPaths(cs);
    return cs.map((c) => ({ t: c.created_at, user: c.author, post: pid, depth: depthOf(paths.get(c.id)!) }));
  });
  limitRows.push(...commentLimitRows(communityComments, Object.fromEntries(accounts), contributionsAt, limits, now));
  const bodies = [...fx.posts, ...fx.comments].map((n) => ({ t: n.created_at, user: n.author, id: n.id, body: fx.text.get(n.id)?.body ?? '' }));
  limitRows.push(...linkLimitRows(bodies, fx.links, Object.fromEntries(accounts), contributionsAt, limits, now));
  compare('expected_limits.csv', limitRows);

  // 5.2 (D-75): the additive scenario set, and the community's own votes through the same detector
  if (signalScenarios.length > 0) {
    const sigRows = signalScenarios.flatMap((sc) => detectSignals(sc, limits).map((s) => ({ scenario: sc.id, kind: s.kind, node: s.node, voters: s.voters, window_start: s.window_start })));
    compare('signals/expected_signals.csv', sigRows);
  }
  // 5.4 B: the report-swarm scenarios (the community fixture has no reports; its false-positive check is the organic scenarios)
  if (swarmScenarios.length > 0 && mod) {
    compare('moderation/expected_report_signals.csv', swarmScenarios.flatMap((sc) => detectReportSwarms(sc, mod).map((s) => ({ scenario: sc.id, author: s.author, reporters: s.reporters, window_start: s.window_start }))));
  }
  const community: SignalScenario = {
    id: 'community',
    note: 'the frozen community fixture',
    accounts: fx.users.map((u) => ({ id: u.id, created_at: u.created_at, contributions: authored.get(u.id) ?? [] })),
    nodes: [...nodes].map(([id, author]) => ({ id, author })),
    events: fx.votes.map((v) => ({ row: v.row, voter: v.voter, node_id: v.node_id, value: v.value, cast_at: v.cast_at })),
  };
  const communitySignals = detectSignals(community, limits);
  const communitySwarms = mod ? detectReportSwarms({ id: 'community', note: 'the organic reports', accounts: fx.users, nodes: [...nodes].map(([id, author]) => ({ id, author })), reports: fx.reports }, mod) : [];

  const tally: Record<Outcome, number> = { APPLIED: 0, TOGGLED_OFF: 0, SWITCHED: 0, SELF_VOTE: 0, GATED_DOWNVOTE: 0, UNKNOWN_NODE: 0 };
  for (const o of outcomes.values()) tally[o]++;
  void isYoung;
  return {
    nodes: nodes.size,
    visiblePosts: visible.length,
    now,
    outcomes: tally,
    files,
    limits: limitRows.map((r) => ({ script: r.script, attempts: r.attempts, allowed: r.allowed, refused: r.refused, firstRetryAfter: r.first_retry_after === '' ? null : Number(r.first_retry_after) })),
    threads,
    communitySignals,
    communitySwarms,
  };
}

/**
 * PRD 6.4 (D-93): the four comment scripts, shared by engine:eval (paths from the fixture) and engine:eval:db (depths
 * as stored). `community` is every community comment as an attempt; the rest are scripted here.
 */
export function commentLimitRows(community: readonly CommentAttempt[], createdAt: Readonly<Record<string, number>>, contributionsAt: (user: string, t: number) => number, limits: LimitRules, now = NOW) {
  const t0 = now - 3600;
  const sorted = [...community].sort((a, b) => a.t - b.t || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0) || (a.post < b.post ? -1 : a.post > b.post ? 1 : 0) || a.depth - b.depth);
  const scripts: [string, CommentAttempt[], ('profile' | 'profile+post')[]][] = [
    ['spam-flood-thread', Array.from({ length: 360 }, (_, i) => ({ t: t0 + 10 * i, user: 'u050', post: 'P-FLOOD', depth: 0 })), ['profile', 'profile+post']],
    ['normal-community-thread', sorted, ['profile+post']],
    ['spam-deep-chain', Array.from({ length: 60 }, (_, i) => ({ t: now - 60 * 400 + 400 * i, user: 'u050', post: 'P-DEEP', depth: i })), ['profile', 'profile+post']],
    ['normal-community-depth', sorted, []],
  ];
  return scripts.map(([script, attempts, scopes]) => {
    const r = replayComments(attempts, createdAt, contributionsAt, limits, scopes);
    return { script, action: 'comment' as const, attempts: attempts.length, allowed: r.allowed, refused: r.refused, first_retry_after: r.firstRetryAfter ?? ('' as const) };
  });
}

/**
 * PRD 7.2 (D-100): the two link scripts, shared by engine:eval (bodies from community/bodies.csv) and engine:eval:db
 * (bodies as stored). `community` is every node with its body; the ones holding a markdown link are the attempts.
 * PRD 7.3 (D-104): plus the three bypass scripts, counted from their bodies.
 */
export function linkLimitRows(community: readonly { t: number; user: string; id: string; body: string }[], cases: readonly LinkCase[], createdAt: Readonly<Record<string, number>>, contributionsAt: (user: string, t: number) => number, limits: LimitRules, now = NOW) {
  const t0 = now - 3600;
  const linked = community
    .map((n) => ({ t: n.t, user: n.user, id: n.id, links: linkHosts(n.body).length }))
    .filter((n) => n.links > 0)
    .sort((a, b) => a.t - b.t || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0) || a.links - b.links || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scripts: [string, LinkAttempt[]][] = [
    ['spam-link-rotation', Array.from({ length: 20 }, (_, i) => ({ t: t0 + 780 * i, user: 'u050', links: 1 }))],
    ['normal-community-links', linked],
    ...linkAttackScripts(cases, now),
  ];
  return scripts.map(([script, attempts]) => {
    const r = replayLinks(attempts, createdAt, contributionsAt, limits);
    return { script, action: 'link' as const, attempts: attempts.length, allowed: r.allowed, refused: r.refused, first_retry_after: r.firstRetryAfter ?? ('' as const) };
  });
}

/** PRD 7.3 (D-104): the steps of the three bypass scripts, shared by the pure copies and abuse:spam. Rotation: the ten
 *  syntaxes the 7.2 counter missed (`links/cases.json`), twice each, at the 7.2 timing. Edit-in: 20 link-free posts
 *  13 min apart (setup, not attempts), then 20 edits a minute apart, each adding a link. Swap: 5 one-link posts, then
 *  15 hourly edits, each moving one post's link to a new host. `before` is the body an edit replaces; a post has none. */
export type LinkStep = { t: number; publicId: string; body: string; before?: string; setup?: true };
export function linkAttacks(cases: readonly LinkCase[], now = NOW): [string, LinkStep[]][] {
  const t0 = now - 3600;
  const gaps = cases.filter((c) => c.anchors === 1 && c.counted_7_2 === 0);
  const plain = (i: number) => `Deal ${i}, link to follow`;
  const swapBody = (k: number) => `Today's deal: <https://swap-${k}.example.test/nas>`;
  return [
    ['spam-link-syntax-rotation', Array.from({ length: 20 }, (_, i) => ({ t: t0 + 780 * i, publicId: `SYN-${i}`, body: `Deal ${i}: ${gaps[i % gaps.length]!.body.replace('.example.test', `-${i}.example.test`)}` }))],
    [
      'spam-link-edit-in',
      [
        ...Array.from({ length: 20 }, (_, i) => ({ t: t0 + 780 * i, publicId: `EDIT-${i}`, body: plain(i), setup: true as const })),
        ...Array.from({ length: 20 }, (_, j) => ({ t: t0 + 780 * 20 + 60 * j, publicId: `EDIT-${j}`, before: plain(j), body: `${plain(j)}: <https://edit-${j}.example.test/nas>` })),
      ],
    ],
    [
      'spam-link-edit-swap',
      [
        ...Array.from({ length: 5 }, (_, i) => ({ t: t0 + 780 * i, publicId: `SWAP-${i}`, body: swapBody(i) })),
        // edit j rewrites post j % 5, whose current body is swapBody(j) (its post, or the edit five before)
        ...Array.from({ length: 15 }, (_, j) => ({ t: t0 + 780 * 5 + 3600 * j, publicId: `SWAP-${j % 5}`, before: swapBody(j), body: swapBody(5 + j) })),
      ],
    ],
  ];
}

function linkAttackScripts(cases: readonly LinkCase[], now: number): [string, LinkAttempt[]][] {
  return linkAttacks(cases, now).map(([script, steps]) => [script, steps.filter((s) => !s.setup).map((s) => ({ t: s.t, user: 'u050', links: s.before === undefined ? linkHosts(s.body).length : 0 }))]);
}
