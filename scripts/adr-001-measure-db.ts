// ADR-001 re-measurement on the real schema (task 2.8, D-22, D-28). Assumes engine:eval:db just ran (the fixture
// is in the test database under org homelab-eval). Thread fetch and permalink subtree against the Prisma Comment
// table (materialized path, its text_pattern_ops index), versus a closure table built from the same rows into a
// TEMP table with the same indexes. EXPLAIN (ANALYZE, BUFFERS), 20 runs after a warm-up, median and p95 in ms.
// Prints a markdown table (CI posts it on the PR). Exit 2 if the closure join beats the path by more than 2× on the
// whole-thread fetch: the stop the task names.
import { db } from '@/core/db';

const RUNS = 20;
const org = await db.org.findUniqueOrThrow({ where: { slug: 'homelab-eval' } });
const thick = await db.post.findFirstOrThrow({ where: { orgId: org.id, publicId: 'P-THICK' }, select: { id: true } });
const deep = await db.comment.findFirstOrThrow({ where: { postId: thick.id, publicId: 'C-THICK-DEEP-00' }, select: { id: true, path: true } });
const version = ((await db.$queryRawUnsafe<{ version: string }[]>('select version()'))[0]!.version).split(',')[0];

// closure table from the stored paths (ancestor, descendant, depth), post as virtual root
await db.$executeRawUnsafe(`DROP TABLE IF EXISTS adr_closure`);
await db.$executeRawUnsafe(`CREATE TEMP TABLE adr_closure AS
  SELECT a."id" AS ancestor, d."id" AS descendant, (length(d."path") - length(a."path")) / 6 AS depth
  FROM "Comment" d JOIN "Comment" a ON a."postId" = d."postId" AND d."path" LIKE a."path" || '%'
  WHERE d."postId" = '${thick.id}'
  UNION ALL SELECT '${thick.id}'::uuid, d."id", d."depth" + 1 FROM "Comment" d WHERE d."postId" = '${thick.id}'`);
await db.$executeRawUnsafe(`ALTER TABLE adr_closure ADD PRIMARY KEY (ancestor, descendant)`);
await db.$executeRawUnsafe(`CREATE INDEX adr_closure_desc ON adr_closure (descendant)`);
await db.$executeRawUnsafe(`ANALYZE adr_closure`);
await db.$executeRawUnsafe(`ANALYZE "Comment"`);

const queries: Record<string, string> = {
  'thread, materialized path (Comment)': `SELECT "id", "path", "depth" FROM "Comment" WHERE "postId" = '${thick.id}' ORDER BY "path"`,
  'thread, closure join': `SELECT c."id", cl.depth FROM adr_closure cl JOIN "Comment" c ON c."id" = cl.descendant WHERE cl.ancestor = '${thick.id}' ORDER BY cl.depth, c."createdAt", c."id"`,
  'permalink subtree, materialized path': `SELECT "id", "path", "depth" FROM "Comment" WHERE "postId" = '${thick.id}' AND "path" LIKE '${deep.path}%' ORDER BY "path"`,
  'permalink subtree, closure join': `SELECT c."id", cl.depth FROM adr_closure cl JOIN "Comment" c ON c."id" = cl.descendant WHERE cl.ancestor = '${deep.id}' ORDER BY cl.depth`,
};
type Plan = { 'Execution Time': number; Plan: { 'Actual Rows': number; 'Shared Hit Blocks': number; 'Shared Read Blocks': number } };
const results: Record<string, { rows: number; median: number; p95: number; hit: number; read: number }> = {};
for (const [name, sql] of Object.entries(queries)) {
  await db.$queryRawUnsafe(sql);
  const times: number[] = [];
  let rows = 0;
  let hit = 0;
  let read = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await db.$queryRawUnsafe<{ 'QUERY PLAN': Plan[] }[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
    const plan = r[0]!['QUERY PLAN'][0]!;
    times.push(plan['Execution Time']);
    rows = plan.Plan['Actual Rows'];
    hit = plan.Plan['Shared Hit Blocks'];
    read = plan.Plan['Shared Read Blocks'];
  }
  times.sort((a, b) => a - b);
  results[name] = { rows, median: times[Math.floor(RUNS / 2)]!, p95: times[Math.ceil(RUNS * 0.95) - 1]!, hit, read };
}
const sizes = await db.$queryRawUnsafe<{ relname: string; bytes: bigint }[]>(`SELECT relname, pg_total_relation_size(oid) AS bytes FROM pg_class WHERE relname IN ('Comment', 'adr_closure')`);
await db.$executeRawUnsafe(`DROP TABLE adr_closure`);
await db.$disconnect();

const r = results;
const path = r['thread, materialized path (Comment)']!;
const closure = r['thread, closure join']!;
console.log(`### ADR-001 re-measurement on ${version} (task 2.8)`);
console.log('');
console.log(`P-THICK, 1,000 comments, ${RUNS} runs after one warm-up, EXPLAIN (ANALYZE, BUFFERS) execution time in ms. The Comment table is the real Prisma schema (whole test database loaded: 5,000 comments); the closure table is a TEMP table built from the same rows.`);
console.log('');
console.log('| Query | Rows | Median | p95 | Buffers (hit / read) |');
console.log('|---|---|---|---|---|');
for (const [name, v] of Object.entries(r)) console.log(`| ${name} | ${v.rows} | ${v.median.toFixed(3)} | ${v.p95.toFixed(3)} | ${v.hit} / ${v.read} |`);
console.log('');
console.log(sizes.map((s) => `${s.relname}: ${(Number(s.bytes) / 1024).toFixed(0)} KiB (table + indexes)`).join('; '));
const ratio = closure.median / path.median;
console.log('');
console.log(`Thread fetch: closure / path median = ${ratio.toFixed(2)}×. ${ratio < 0.5 ? '**STOP: the closure table wins by more than 2× (task 2.8).**' : 'Materialized path stands (D-28).'}`);
if (ratio < 0.5) process.exit(2);
