// ADR-001 measurement (task 1.6, D-22): the P-THICK fixture thread (1,000 comments) loaded into a throwaway database
// two ways, materialized path vs closure table, full-subtree fetch of the post timed with EXPLAIN (ANALYZE, BUFFERS),
// median and p95 of 20 runs after one warm-up. Also the permalink shape (subtree of one deep node). Throwaway: creates
// and drops its own tables in the database named by ADR_DATABASE_URL (default: local postgres, db commons_adr).
// Not product code; the Phase 2 schema is measured again on CI's Postgres 17 (C-3).
import pg from 'pg';
import { loadFixtures } from '@/fixtures/load';
import { assignPaths, depthOf } from '@/tree';

const url = process.env.ADR_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/commons_adr';
const RUNS = 20;

async function main() {
  const { comments } = loadFixtures();
  const thick = comments.filter((c) => c.post_id === 'P-THICK');
  const paths = assignPaths(thick);
  const deep = thick.find((c) => c.id === 'C-THICK-DEEP-00')!; // 12-node chain root: the permalink case
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const v = (await client.query('select version()')).rows[0].version as string;
  await client.query(`drop table if exists mp_comment; drop table if exists cl_comment; drop table if exists cl_closure;`);
  await client.query(`create table mp_comment (id text primary key, post_id text not null, path text not null, depth int not null, created_at bigint not null);
                      create index mp_comment_path on mp_comment (post_id, path text_pattern_ops);`);
  await client.query(`create table cl_comment (id text primary key, post_id text not null, parent_id text, created_at bigint not null);
                      create table cl_closure (ancestor text not null, descendant text not null, depth int not null, primary key (ancestor, descendant));
                      create index cl_closure_desc on cl_closure (descendant);`);
  // load
  const mpValues: unknown[] = [];
  const mpRows = thick.map((c, i) => {
    mpValues.push(c.id, c.post_id, paths.get(c.id)!, depthOf(paths.get(c.id)!), c.created_at);
    return `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`;
  });
  await client.query(`insert into mp_comment values ${mpRows.join(',')}`, mpValues);
  const clValues: unknown[] = [];
  const clRows = thick.map((c, i) => {
    clValues.push(c.id, c.post_id, c.parent_id || null, c.created_at);
    return `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`;
  });
  await client.query(`insert into cl_comment values ${clRows.join(',')}`, clValues);
  // closure rows: every (ancestor, descendant) pair incl. self, plus the post as a virtual root 'P-THICK'
  const pairs: string[] = [];
  const pv: unknown[] = [];
  let k = 0;
  const push = (a: string, d: string, depth: number) => {
    pv.push(a, d, depth);
    pairs.push(`($${++k},$${++k},$${++k})`);
  };
  for (const c of thick) {
    const p = paths.get(c.id)!;
    push('P-THICK', c.id, depthOf(p) + 1);
    push(c.id, c.id, 0);
    const byPath = new Map([...paths].map(([id, pp]) => [pp, id]));
    for (let s = 6; s < p.length; s += 6) push(byPath.get(p.slice(0, s))!, c.id, (p.length - s) / 6);
  }
  for (let i = 0; i < pairs.length; i += 5000) await client.query(`insert into cl_closure values ${pairs.slice(i, i + 5000).join(',')}`, pv.slice(i * 3, (i + 5000) * 3));
  await client.query('analyze mp_comment; analyze cl_comment; analyze cl_closure;');

  const queries: Record<string, string> = {
    'thread, materialized path': `select id, path, depth from mp_comment where post_id = 'P-THICK' order by path`,
    'thread, closure join': `select c.id, cl.depth from cl_closure cl join cl_comment c on c.id = cl.descendant where cl.ancestor = 'P-THICK' order by cl.depth, c.created_at, c.id`,
    'permalink subtree, materialized path': `select id, path, depth from mp_comment where post_id = 'P-THICK' and path like '${paths.get(deep.id)}%' order by path`,
    'permalink subtree, closure join': `select c.id, cl.depth from cl_closure cl join cl_comment c on c.id = cl.descendant where cl.ancestor = '${deep.id}' order by cl.depth`,
  };
  const results: Record<string, { rows: number; median: number; p95: number; buffers: string }> = {};
  for (const [name, sql] of Object.entries(queries)) {
    await client.query(sql); // warm-up
    const times: number[] = [];
    let rows = 0;
    let buffers = '';
    for (let i = 0; i < RUNS; i++) {
      const r = await client.query(`explain (analyze, buffers, format json) ${sql}`);
      const plan = r.rows[0]['QUERY PLAN'][0];
      times.push(plan['Execution Time'] as number);
      rows = plan.Plan['Actual Rows'] as number;
      buffers = `shared hit ${plan.Plan['Shared Hit Blocks']}, read ${plan.Plan['Shared Read Blocks']}`;
    }
    times.sort((a, b) => a - b);
    results[name] = { rows, median: times[Math.floor(RUNS / 2)]!, p95: times[Math.ceil(RUNS * 0.95) - 1]!, buffers };
  }
  const sizes = (await client.query(`select relname, pg_total_relation_size(oid) as bytes from pg_class where relname in ('mp_comment','cl_comment','cl_closure') order by 1`)).rows;
  await client.query(`drop table mp_comment; drop table cl_comment; drop table cl_closure;`);
  await client.end();
  console.log(`ADR-001 measurement — ${v.split(',')[0]}; P-THICK ${thick.length} comments, max depth ${Math.max(...[...paths.values()].map(depthOf))}; ${RUNS} runs each after one warm-up; EXPLAIN (ANALYZE, BUFFERS) execution time in ms`);
  for (const [name, r] of Object.entries(results)) console.log(`${name.padEnd(38)} rows ${String(r.rows).padStart(5)}  median ${r.median.toFixed(3)}  p95 ${r.p95.toFixed(3)}  (${r.buffers})`);
  for (const s of sizes) console.log(`size ${s.relname.padEnd(12)} ${(Number(s.bytes) / 1024).toFixed(0)} KiB (table + indexes)`);
  console.log(`closure rows: ${pairs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
