import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ForumForm as ActionForm } from '@/components/forum-form';
import { ago, Markdown, Text, when } from '@/components/forum';
import { authorHistory, canModerate, modLog, queue, type QueueItem } from '@/forum/moderation';
import { ensureProfile } from '@/forum/view';
import { parseLimitRules, parseModerationRules } from '@/rules';
import { moderateContent, moderateThread, moderateUser, reviewBrigade, reviewDuplicate } from '../actions';

const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const signalRules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8'))).signals;
const brigadeRule = signalRules.brigade;
const mins = (s: number) => Math.round(s / 60);
/** 5.2: one heading per signal kind; the numbers come from rules/limits.json. */
const signalHeading = (kind: 'BRIGADE' | 'RING' | 'AGED_BRIGADE', n: number) =>
  kind === 'RING'
    ? `Suspected upvote ring: ${n} new accounts upvoted within ${mins(signalRules.ring.window_seconds)} min`
    : kind === 'AGED_BRIGADE'
      ? `Suspected brigade from accounts under ${signalRules.aged_brigade.max_account_age_days} days: ${n} downvotes within ${mins(signalRules.aged_brigade.window_seconds)} min`
      : `Suspected brigade: ${n} gated downvotes`;

/** 5.4 A: the filterable kinds — a BRIGADE row carries which vote signal it is. */
const KINDS = ['CASE', 'BRIGADE', 'RING', 'AGED_BRIGADE', 'DUPLICATE'] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (i: QueueItem): Kind => (i.kind === 'BRIGADE' ? i.signal : i.kind);
const EXCERPT = 240;
const excerpt = (body: string) => {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat;
};
const query = (o: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== 1) s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
};

/** Task 4.4 / PRD 5.4 A: open cases and signals as compact rows with filters, counts and paging; the author's and the
 *  reporters' records; warn / ban / lock in place; the append-only log paged with `seq`. Moderators only ("not yours"
 *  ≡ not found for everyone else). */
export const metadata = { title: 'Moderation queue · Commons' };

export default async function ModQueue({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  if (!canModerate(me)) notFound();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? '';
  const kind = (KINDS as readonly string[]).includes(one('kind')) ? (one('kind') as Kind) : undefined;
  const reason = mod.report_reasons.some((r) => r.code === one('reason')) ? one('reason') : undefined;
  const pageNo = Math.max(1, Math.floor(Number(one('page')) || 1));
  const logPageNo = Math.max(1, Math.floor(Number(one('logPage')) || 1));
  const size = mod.queue.page_size;
  const base = `/o/${ctx.slug}/f`;
  const here = `${base}/mod${query({ kind, reason, page: pageNo })}`;

  const all = await queue(db, ctx.orgId);
  const counts = Object.fromEntries(KINDS.map((k) => [k, all.filter((i) => kindOf(i) === k).length])) as Record<Kind, number>;
  const reasonCounts = Object.fromEntries(mod.report_reasons.map((r) => [r.code, all.filter((i) => i.kind === 'CASE' && i.reasons.includes(r.code)).length])) as Record<string, number>;
  const filtered = all.filter((i) => (!kind || kindOf(i) === kind) && (!reason || (i.kind === 'CASE' && i.reasons.includes(reason))));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const items = filtered.slice((pageNo - 1) * size, pageNo * size);

  // context for every node on this page
  const postIds = items.filter((i) => i.node.kind === 'POST').map((i) => i.node.id);
  const commentIds = items.filter((i) => i.node.kind === 'COMMENT').map((i) => i.node.id);
  const [posts, comments] = await Promise.all([
    db.post.findMany({ where: { id: { in: postIds }, orgId: ctx.orgId }, include: { author: true } }),
    db.comment.findMany({ where: { id: { in: commentIds }, orgId: ctx.orgId }, include: { author: true, post: { select: { publicId: true, title: true, lockedAt: true } } } }),
  ]);
  const ctxOf = (node: { kind: 'POST' | 'COMMENT'; id: string }) => {
    if (node.kind === 'POST') {
      const p = posts.find((x) => x.id === node.id);
      return p ? { title: p.title, body: p.body, author: p.author, status: p.status, postId: p.id, commentId: undefined as string | undefined, locked: !!p.lockedAt, link: `${base}/p/${p.publicId}` } : null;
    }
    const c = comments.find((x) => x.id === node.id);
    return c ? { title: `comment on ${c.post.title}`, body: c.body, author: c.author, status: c.status, postId: c.postId, commentId: c.id, locked: !!c.post.lockedAt, link: `${base}/p/${c.post.publicId}/c/${c.publicId}` } : null;
  };
  const log = await modLog(db, ctx.orgId, logPageNo, size);
  const Back = () => <input type="hidden" name="back" value={here} />;

  return (
    <main id="main" tabIndex={-1}>
      <h1>Moderation queue</h1>
      <p className="meta">
        {all.length} open item{all.length === 1 ? '' : 's'}: cases from reports, vote signals (brigade: ≥ {brigadeRule.min_voters} gated downvotes in {mins(brigadeRule.window_seconds)} min; ring: ≥ {signalRules.ring.min_voters} upvotes from new accounts in {mins(signalRules.ring.window_seconds)} min; aged brigade: ≥ {signalRules.aged_brigade.min_voters} downvotes from accounts under {signalRules.aged_brigade.max_account_age_days} days in {mins(signalRules.aged_brigade.window_seconds)} min), duplicate signals. Nothing here was acted on automatically.
      </p>
      <nav className="filters" aria-label="Filter by kind">
        <Link href={`${base}/mod${query({ reason })}`} aria-current={kind ? undefined : 'page'}>
          All ({all.length})
        </Link>
        {KINDS.map((k) => (
          <Link key={k} href={`${base}/mod${query({ kind: k, reason })}`} aria-current={kind === k ? 'page' : undefined}>
            {k} ({counts[k]})
          </Link>
        ))}
      </nav>
      <nav className="filters" aria-label="Filter by report reason">
        <Link href={`${base}/mod${query({ kind })}`} aria-current={reason ? undefined : 'page'}>
          Any reason
        </Link>
        {mod.report_reasons
          .filter((r) => reasonCounts[r.code]! > 0 || r.code === reason)
          .map((r) => (
            <Link key={r.code} href={`${base}/mod${query({ kind, reason: r.code })}`} aria-current={reason === r.code ? 'page' : undefined}>
              {r.code} ({reasonCounts[r.code]})
            </Link>
          ))}
      </nav>
      {filtered.length === 0 && <p>{all.length === 0 ? 'The queue is empty.' : 'Nothing matches this filter.'}</p>}
      {await Promise.all(
        items.map(async (item) => {
          const c = ctxOf(item.node);
          if (!c) return null;
          const hist = await authorHistory(db, c.author.id);
          return (
            <section key={`${item.kind}-${item.id}`} aria-label={`${item.kind} on ${c.title}`} className="post">
              <h2>
                <span className="badge">{kindOf(item)}</span> {item.kind === 'CASE' ? `Reported (${item.reports}): ${item.reasons.join(', ')}` : item.kind === 'BRIGADE' ? signalHeading(item.signal, item.voterCount) : 'Suspected duplicate'} · <Link href={c.link}><Text value={c.title} /></Link>
              </h2>
              <p className="meta">
                by <Link href={`${base}/u/${c.author.handle}`}><Text value={c.author.handle} /></Link> ({c.author.modState}; {hist.reports} reports on their posts, {hist.actions} prior actions) · status {c.status}
                {c.locked && ' · thread locked'} · opened {when(item.kind === 'CASE' ? item.openedAt : item.createdAt)}
              </p>
              {item.kind === 'CASE' && (
                <ul aria-label="Reporters">
                  {item.reporters.map((r, i) => (
                    <li key={i} className="meta">
                      <Link href={`${base}/u/${r.handle}`}><Text value={r.handle} /></Link> (joined {ago(r.joinedAt)}; {r.removed} removed / {r.cleared} cleared before): {r.reason}
                      {r.detail && (
                        <>
                          {' — '}
                          <Text value={r.detail} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="excerpt">
                <Text value={excerpt(c.body)} />
              </p>
              <details>
                <summary>Show full text</summary>
                <Markdown body={c.body} />
              </details>
              {item.kind === 'CASE' && (
                <>
                  <ActionForm action={moderateContent.bind(null, ctx.slug)}>
                    <input type="hidden" name="postId" value={c.postId} />
                    {c.commentId && <input type="hidden" name="commentId" value={c.commentId} />}
                    <Back />
                    <label>
                      Reason <input name="reason" required maxLength={1000} aria-label={`Reason for ${c.title}`} />
                    </label>
                    <button type="submit" name="action" value="REMOVE">Remove</button> <button type="submit" name="action" value="CLEAR">Clear</button>
                  </ActionForm>
                  <details>
                    <summary>Author and thread actions</summary>
                    <ActionForm action={moderateUser.bind(null, ctx.slug)}>
                      <input type="hidden" name="handle" value={c.author.handle} />
                      <Back />
                      <label>
                        Reason <input name="reason" required maxLength={1000} aria-label={`Reason for the author of ${c.title}`} />
                      </label>
                      {c.author.modState === 'BANNED' ? (
                        <button type="submit" name="action" value="UNBAN">Unban</button>
                      ) : (
                        <>
                          <label>
                            Ban length
                            <select name="hours" defaultValue="24" aria-label={`Ban length for the author of ${c.title}`}>
                              {mod.ban_durations_hours.map((h) => (
                                <option key={h} value={h}>
                                  {h === 0 ? 'permanent' : `${h} h`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button type="submit" name="action" value="WARN">Warn</button> <button type="submit" name="action" value="BAN">Ban</button>
                        </>
                      )}
                    </ActionForm>
                    <ActionForm action={moderateThread.bind(null, ctx.slug)}>
                      <input type="hidden" name="postId" value={c.postId} />
                      <Back />
                      <label>
                        Reason <input name="reason" required maxLength={1000} aria-label={`Reason for the thread of ${c.title}`} />
                      </label>
                      <button type="submit" name="action" value={c.locked ? 'UNLOCK' : 'LOCK'}>{c.locked ? 'Unlock thread' : 'Lock thread'}</button>
                    </ActionForm>
                  </details>
                </>
              )}
              {item.kind === 'BRIGADE' && (
                <ActionForm action={reviewBrigade.bind(null, ctx.slug)}>
                  <input type="hidden" name="brigadeSignalId" value={item.id} />
                  <label>
                    Note <input name="reason" required maxLength={1000} aria-label={`Review note for brigade on ${c.title}`} />
                  </label>
                  <button type="submit">Mark reviewed</button>
                </ActionForm>
              )}
              {item.kind === 'DUPLICATE' && (
                <ActionForm action={reviewDuplicate.bind(null, ctx.slug)}>
                  <input type="hidden" name="duplicateSignalId" value={item.id} />
                  <label>
                    Note <input name="reason" required maxLength={1000} aria-label={`Review note for duplicate ${c.title}`} />
                  </label>
                  <button type="submit">Mark reviewed</button>
                </ActionForm>
              )}
            </section>
          );
        }),
      )}
      {pages > 1 && (
        <nav className="filters" aria-label="Queue pages">
          {pageNo > 1 && <Link href={`${base}/mod${query({ kind, reason, page: pageNo - 1 })}`}>Previous</Link>}
          <span className="meta">Page {pageNo} of {pages}</span>{' '}
          {pageNo < pages && <Link href={`${base}/mod${query({ kind, reason, page: pageNo + 1 })}`}>Next</Link>}
        </nav>
      )}
      <h2>Moderation log</h2>
      <p className="meta">
        Append-only: the database refuses UPDATE and DELETE on these rows. {log.total} entr{log.total === 1 ? 'y' : 'ies'}; <code>seq</code> is the total order (D-56).
      </p>
      <table>
        <thead>
          <tr>
            <th>seq</th>
            <th>When</th>
            <th>Action</th>
            <th>Target</th>
            <th>From → to</th>
            <th>By</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {log.rows.map((l) => (
            <tr key={l.id}>
              <td>{String(l.seq)}</td>
              <td>{when(l.createdAt)}</td>
              <td>{l.kind}</td>
              <td>{l.target ? <Link href={`${base}${l.target.path}`}><Text value={l.target.label} /></Link> : `${l.nodeKind} ${l.nodeId?.slice(0, 8)}`}</td>
              <td>
                {l.fromState} → {l.toState}
              </td>
              <td>
                <Text value={l.actor.handle} />
              </td>
              <td>
                <Text value={l.reason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.pages > 1 && (
        <nav className="filters" aria-label="Log pages">
          {logPageNo > 1 && <Link href={`${base}/mod${query({ kind, reason, page: pageNo, logPage: logPageNo - 1 })}`}>Previous log page</Link>}
          <span className="meta">Log page {logPageNo} of {log.pages}</span>{' '}
          {logPageNo < log.pages && <Link href={`${base}/mod${query({ kind, reason, page: pageNo, logPage: logPageNo + 1 })}`}>Next log page</Link>}
        </nav>
      )}
    </main>
  );
}
