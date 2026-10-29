// votes:verify (task 2.5, non-negotiable 3): recompute every node's counts from Vote rows and from the event log
// and diff both against the cached ups/downs. Exit 1 naming the first mismatch. --org <slug> (default "homelab").
import { db } from '@/core/db';
import { votesVerify } from '@/forum/votes';

const i = process.argv.indexOf('--org');
const slug = i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : 'homelab';
const org = await db.org.findUnique({ where: { slug } });
if (!org) {
  console.error(`votes:verify: no org ${slug}`);
  process.exit(1);
}
const { nodes, mismatches } = await votesVerify(db, org.id);
for (const m of mismatches.slice(0, 20)) console.error(`votes:verify: ${m.nodeKind} ${m.publicId}: cached ${m.cached}, from Vote rows ${m.fromVotes}, from events ${m.fromEvents}`);
await db.$disconnect();
if (mismatches.length) {
  console.error(`votes:verify: FAIL — ${mismatches.length} of ${nodes} nodes disagree`);
  process.exit(1);
}
console.log(`votes:verify: OK — ${nodes} nodes; cache = Vote rows = event replay`);
