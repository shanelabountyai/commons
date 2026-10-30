import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ForumForm as ActionForm } from '@/components/forum-form';
import { Text, when } from '@/components/forum';
import { canModerate } from '@/forum/moderation';
import { ensureProfile, profilePage } from '@/forum/view';
import { parseModerationRules } from '@/rules';
import { moderateUser, moderatorFlag } from '../../actions';

const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));

/** P1-2: history and counts; moderators see the state machine controls and the log for this member. */
export default async function ProfilePage({ params }: { params: Promise<{ org: string; handle: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  const { handle } = await params;
  const v = await profilePage(ctx.orgId, handle);
  if (!v) notFound();
  const isMod = canModerate(me);
  const log = isMod ? await db.moderationAction.findMany({ where: { subjectId: v.profile.id }, orderBy: { seq: 'desc' }, take: 20, include: { actor: { select: { handle: true } } } }) : [];
  return (
    <main>
      <h1>
        <Text value={v.profile.handle} />
      </h1>
      <p className="meta">
        Joined {when(v.profile.joinedAt)} · {v.contributions} contributions{v.profile.isModerator ? ' · moderator' : ''}
        {isMod && ` · state ${v.profile.modState}${v.profile.bannedUntil ? ` until ${when(v.profile.bannedUntil)}` : ''}`}
      </p>
      <h2>Posts</h2>
      <ul>
        {v.posts.map((p) => (
          <li key={p.publicId}>
            <Link href={`/o/${ctx.slug}/f/p/${p.publicId}`}>
              <Text value={p.title} />
            </Link>{' '}
            <span className="meta">
              {p.ups - p.downs} points · {p.createdAt.toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
      <h2>Comments</h2>
      <ul>
        {v.comments.map((c) => (
          <li key={c.publicId}>
            <Link href={`/o/${ctx.slug}/f/p/${c.post.publicId}/c/${c.publicId}`}>on <Text value={c.post.title} /></Link>: <span className="meta">{c.body.slice(0, 100).replace(/\s+/g, ' ')}{c.body.length > 100 ? '…' : ''}</span>
          </li>
        ))}
      </ul>
      {isMod && v.profile.id !== me.profileId && (
        <section aria-label="Moderation">
          <h2>Moderate this member</h2>
          <ActionForm action={moderateUser.bind(null, ctx.slug)}>
            <input type="hidden" name="handle" value={v.profile.handle} />
            <label>
              Reason <input name="reason" required maxLength={1000} />
            </label>
            <label>
              Ban length
              <select name="hours" defaultValue="24">
                {mod.ban_durations_hours.map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'permanent' : `${h} h`}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" name="action" value="WARN">Warn</button> <button type="submit" name="action" value="BAN">Ban</button>{' '}
            <button type="submit" name="action" value="UNBAN">Unban</button>
          </ActionForm>
          {(me.role === 'owner' || me.role === 'admin') && (
            <ActionForm action={moderatorFlag.bind(null, ctx.slug)}>
              <input type="hidden" name="handle" value={v.profile.handle} />
              <label>
                Reason <input name="reason" required maxLength={1000} aria-label="Reason for changing the moderator flag" />
              </label>
              {v.profile.isModerator ? (
                <button type="submit" name="action" value="REVOKE_MOD">Revoke moderator</button>
              ) : (
                <button type="submit" name="action" value="GRANT_MOD">Make moderator</button>
              )}{' '}
              <span className="meta">(owner/admin only; logged, D-48)</span>
            </ActionForm>
          )}
          <h3>Moderation log for this member</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>From → to</th>
                <th>By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td>{when(l.createdAt)}</td>
                  <td>{l.kind}</td>
                  <td>
                    {l.fromState} → {l.toState}
                    {l.until ? ` (until ${when(l.until)})` : ''}
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
        </section>
      )}
    </main>
  );
}
