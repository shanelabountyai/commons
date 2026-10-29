// rank:recompute (task 2.6, R-5): replace the org's RankSnapshot rows. --org <slug> (default "homelab"),
// --now <epoch seconds> (default: the clock). The cron calls recomputeRanks directly; this is the CLI.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { recomputeRanks } from '@/forum/rank';
import { parseRankingRules } from '@/rules';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : undefined;
};
const slug = arg('--org') ?? 'homelab';
const now = arg('--now') ? Number(arg('--now')) : Math.floor(Date.now() / 1000);
const org = await db.org.findUnique({ where: { slug } });
if (!org) {
  console.error(`rank:recompute: no org ${slug}`);
  process.exit(1);
}
const rules = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const r = await db.$transaction((tx) => recomputeRanks(tx, org.id, now, rules), { timeout: 120_000 });
console.log(`rank:recompute: ${r.posts} posts, ${r.comments} comments ranked at ${now}`);
await db.$disconnect();
