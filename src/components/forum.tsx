// Shared server components for the forum pages. All user text reaches the DOM through src/render (non-negotiable 1);
// the Markdown and Text wrappers live there. The scope note is one sentence in one place.
export { Markdown, Text } from '@/render/components';
import { ago as agoText, when as whenText } from '@/forum/time';

export function ScopeNote() {
  return (
    <aside className="scope" aria-label="Scope">
      <p>
        <strong>Learning project, synthetic community.</strong> Every account, post and vote here was generated from a seed; rankings use published formulas with the constants in <code>rules/</code>; moderation is rule-based. Nothing is a measure of real spam or real people.
      </p>
    </aside>
  );
}

/** Absolute time, UTC to the minute, machine-readable (4.1.13). */
export const when = (d: Date) => <time dateTime={d.toISOString()}>{whenText(d)}</time>;
/** Relative time with a scaled unit; the absolute value sits in the title and dateTime. */
export const ago = (d: Date | null) => (d ? <time dateTime={d.toISOString()} title={whenText(d)}>{agoText(d, new Date())}</time> : <>not yet</>);
