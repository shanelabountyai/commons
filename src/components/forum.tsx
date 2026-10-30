// Shared server components for the forum pages. All user text reaches the DOM through src/render (non-negotiable 1);
// the Markdown and Text wrappers live there. The scope note is one sentence in one place.
export { Markdown, Text } from '@/render/components';

export function ScopeNote() {
  return (
    <aside className="scope" aria-label="Scope">
      <p>
        <strong>Learning project, synthetic community.</strong> Every account, post and vote here was generated from a seed; rankings use published formulas with the constants in <code>rules/</code>; moderation is rule-based. Nothing is a measure of real spam or real people.
      </p>
    </aside>
  );
}

export const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const ago = (d: Date | null) => (d ? `${Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000))} min ago` : 'not yet');
