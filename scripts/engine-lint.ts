// engine:lint (task 1.1/1.3; CLAUDE.md non-negotiables 5 and 6). Exit 1 on the first problem, naming file and rule.
//   1. Nothing under the four engine dirs names Prisma, @/core, @/app, @/modules, Date.now, new Date(, Date.parse,
//      Math.random, random bytes, process.env, fetch, timers or anthropic: the engines are pure and `now` is a
//      parameter (D-7). Floats are allowed here (D-9: rankings are floats), unlike Quorum's tally.
//   2. rules/ranking.json and rules/limits.json parse against the closed schemas once src/rules exists (task 1.4).
// Ported from quorum scripts/tally-lint.ts (itself after Gavel scripts/rules-lint.ts), purity half only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ENGINE_DIRS = ['src/tree', 'src/ranking', 'src/votes', 'src/limits'];

const BANNED: [RegExp, string][] = [
  [/prisma/i, 'prisma (database)'],
  [/@\/core/, '@/core'],
  [/@\/app/, '@/app'],
  [/@\/modules/, '@/modules'],
  [/@\/generated/, '@/generated (prisma client)'],
  [/\bDate\.now\b/, 'Date.now (clock)'],
  [/\bnew\s+Date\s*\(/, 'new Date( (clock)'],
  [/\bDate\.parse\b/, 'Date.parse (clock)'],
  [/\bMath\.random\b/, 'Math.random (randomness)'],
  [/\brandomUUID\b|\brandomBytes\b|\bgetRandomValues\b/, 'random bytes (randomness)'],
  [/\bprocess\.env\b/, 'process.env'],
  [/\bfetch\s*\(/, 'fetch (network)'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/anthropic/i, 'anthropic (model client)'],
  [/\bnode:fs\b|\bnode:child_process\b|\bnode:net\b|\bnode:http\b/, 'node I/O module'],
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Problems in one engine source file, as "path: what" lines; empty means clean. */
export function lintEngineSource(path: string, source: string): string[] {
  const code = stripComments(source);
  return BANNED.filter(([re]) => re.test(code)).map(([, what]) => `${path}: ${what}`);
}

export function lintEngineDirs(dirs = ENGINE_DIRS): { problems: string[]; files: number } {
  const problems: string[] = [];
  let files = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue; // created task by task; a missing dir is not a failure
    const list = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
      .map((d) => `${d.parentPath}/${d.name}`)
      .sort();
    files += list.length;
    for (const p of list) problems.push(...lintEngineSource(p, readFileSync(p, 'utf8')));
  }
  return { problems, files };
}

/** D-33 / non-negotiable 2: only src/forum/tree-write.ts creates Post or Comment rows. */
export function lintSingleWriter(root = 'src'): string[] {
  const out: string[] = [];
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !d.parentPath.includes('generated'));
  for (const d of files) {
    const p = `${d.parentPath}/${d.name}`;
    if (p.endsWith('src/forum/tree-write.ts')) continue;
    const code = stripComments(readFileSync(p, 'utf8'));
    if (/\b(post|comment)\.(create|createMany|upsert)\s*\(/.test(code)) out.push(`${p}: creates Post/Comment rows outside src/forum/tree-write.ts`);
  }
  return out;
}

/** Non-negotiable 1 / task 3.3: the sanitizer libraries and dangerouslySetInnerHTML live in src/render only. */
export function lintSingleRenderer(root = 'src'): string[] {
  const out: string[] = [];
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !d.parentPath.includes('generated'));
  for (const d of files) {
    const p = `${d.parentPath}/${d.name}`;
    if (p.includes('src/render/')) continue;
    const code = stripComments(readFileSync(p, 'utf8'));
    if (/dangerouslySetInnerHTML/.test(code)) out.push(`${p}: dangerouslySetInnerHTML outside src/render`);
    if (/from ['"](markdown-it|isomorphic-dompurify|dompurify)['"]/.test(code)) out.push(`${p}: imports a sanitizer library outside src/render`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lint = lintEngineDirs();
  const problems = [...lint.problems, ...lintSingleWriter(), ...lintSingleRenderer()];
  const files = lint.files;
  for (const p of problems) console.error(`engine:lint: ${p}`);
  if (problems.length) process.exit(1);
  let rulesNote = 'rules schema check pending task 1.4';
  if (existsSync('src/rules/index.ts')) {
    const { parseRankingRules, parseLimitRules } = await import('../src/rules/index');
    const r = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
    const l = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
    rulesNote = `rules/ranking.json valid (gravity ${r.hot.gravity_seconds}s, z ${r.best.z}); rules/limits.json valid (${l.windows.length} windows)`;
  }
  console.log(`engine:lint: OK (${files} files under ${ENGINE_DIRS.join(', ')} clean; ${rulesNote})`);
}
