// commons:load (task 2.4): the fixture forum into one org, write-once. --org <slug> (default "homelab"),
// --fixtures <dir>. Runs in one transaction; a second run inserts nothing.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { db } from '@/core/db';
import { loadFixtures } from '@/fixtures/load';
import { loadForum } from '@/forum/load';
import { parseLimitRules } from '@/rules';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};

export async function ensureOrg(slug: string): Promise<string> {
  const have = await db.org.findUnique({ where: { slug } });
  return (have ?? (await db.org.create({ data: { slug, name: slug } }))).id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const orgId = await ensureOrg(arg('--org', 'homelab'));
  const fx = loadFixtures(arg('--fixtures', 'fixtures'));
  const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
  const t = Date.now();
  const report = await db.$transaction((tx) => loadForum(tx, orgId, fx, rules), { timeout: 600_000, maxWait: 10_000 });
  for (const r of report) console.log(`${r.table.padEnd(10)} wanted ${String(r.wanted).padStart(6)}  existing ${String(r.existing).padStart(6)}  inserted ${String(r.inserted).padStart(6)}`);
  console.log(`commons:load: ${report.reduce((n, r) => n + r.inserted, 0)} rows in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await db.$disconnect();
}
