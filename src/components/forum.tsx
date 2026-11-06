// Shared server components for the forum pages. All user text reaches the DOM through src/render (non-negotiable 1);
// the Markdown and Text wrappers live there. The scope note is one sentence in one place.
export { Markdown, Text } from '@/render/components';
import { Text } from '@/render/components';
import { ago as agoText, when as whenText } from '@/forum/time';
export { whenText };

import Link from 'next/link';

/** 6.1 A (D-84): the scope sentence once per page, as the org layout's footer; `children` is the owner's danger link. */
export function ScopeNote({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="scope" aria-label="Scope">
      <p>
        <strong>Learning project, synthetic community.</strong> Every account, post and vote here was generated from a seed; rankings use published formulas with the constants in <code>rules/</code>; moderation is rule-based. Nothing is a measure of real spam or real people.
      </p>
      {children}
    </footer>
  );
}

export type BadgeRole = 'pin' | 'warn' | 'danger' | 'ok' | 'muted';
/** A text status marker (never an emoji): Pinned, Locked, Removed, Deleted, Edited, a queue kind. */
export const Badge = ({ role = 'muted', children }: { role?: BadgeRole; children: React.ReactNode }) => <span className={`badge badge-${role}`}>{children}</span>;

/** Previous / numbered / Next links; `href(n)` keeps the page's other query parameters. */
export function Pager({ page, pages, href, label }: { page: number; pages: number; href: (n: number) => string; label: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <Link key={n} href={href(n)} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}>
          {n}
        </Link>
      ))}
      {page < pages && <Link href={href(page + 1)}>Next</Link>}
    </nav>
  );
}

/** Breadcrumb: links for the ancestors, text for the current page (last item), no trailing separator. */
export function Crumbs({ items }: { items: { href?: string; text: React.ReactNode }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((it, i) => (
          <li key={i} aria-current={i === items.length - 1 ? 'page' : undefined}>{it.href ? <Link href={it.href}>{it.text}</Link> : it.text}</li>
        ))}
      </ol>
    </nav>
  );
}

/** Absolute time, UTC to the minute, machine-readable (4.1.13). */
export const when = (d: Date) => <time dateTime={d.toISOString()}>{whenText(d)}</time>;
/** Relative time with a scaled unit; the absolute value sits in the title and dateTime. */
export const ago = (d: Date | null) => (d ? <time dateTime={d.toISOString()} title={whenText(d)}>{agoText(d, new Date())}</time> : <>not yet</>);

/** 6.1 B (M2): a removed or deleted comment is named by its status, never "Comment by removed". */
export const removedName = (status: string) => (status === 'deleted' ? 'Deleted comment' : 'Removed comment (by moderator)');

/** One heading per comment, so heading navigation lists every comment; the author link, or the status name with its badge. */
export function CommentHeading({ status, author, href }: { status: string; author: string; href: string }) {
  return (
    <h3 className="meta">
      {status === 'body' || status === 'visible' ? (
        <Link href={href}>
          <Text value={author} />
        </Link>
      ) : (
        <>
          {removedName(status)} <Badge role={status === 'deleted' ? 'muted' : 'danger'}>{status === 'deleted' ? 'Deleted' : 'Removed'}</Badge>
        </>
      )}
    </h3>
  );
}

/**
 * 6.1 B (M1): rows the tree engine already rendered (flat, with depth) → nested <ol>s. Each subtree sits in a
 * <details open> whose summary counts the rows rendered below it on this page — "shown", because the depth cut
 * (D-15) and the comment page can hide descendants. Collapse is the reader's browser state; the DOM keeps every row.
 */
export function Tree<R extends { id: string; depth: number }>({ rows, item }: { rows: readonly R[]; item: (r: R) => React.ReactNode }) {
  const walk = (from: number, depth: number): [React.ReactNode[], number] => {
    const out: React.ReactNode[] = [];
    let i = from;
    while (i < rows.length && rows[i]!.depth === depth) {
      const r = rows[i]!;
      const [kids, next] = walk(i + 1, depth + 1);
      const shown = next - i - 1;
      out.push(
        <li key={r.id} id={r.id} className="c" tabIndex={-1}>
          {item(r)}
          {kids.length > 0 && (
            <details open>
              <summary>
                {shown} {shown === 1 ? 'reply' : 'replies'} shown
              </summary>
              <ol>{kids}</ol>
            </details>
          )}
        </li>,
      );
      i = next;
    }
    return [out, i];
  };
  return <ol className="thread">{walk(0, rows[0]?.depth ?? 0)[0]}</ol>;
}
