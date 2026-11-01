'use client';
// 4.1.12 (P0-4 "nothing is dropped silently"): the forum's form. Same contract as the template's ActionForm
// (`{ error }` or `{ notice }` from an orgAction; disabled while pending) plus two things the template's does not do:
// after a refusal the typed text is put back (React 19 resets uncontrolled fields when a form action settles, so a
// 50,000-char post refused RATE_LIMITED would vanish), and the refusal takes focus so it is heard (WCAG 3.3.1).
// src/core/ui/action-form.tsx is template-owned; this is the clone's copy, and the gap is noted upstream (D-67).
import { useActionState, useEffect, useRef } from 'react';

type Snapshot = Record<string, string>;

export function ForumForm({ action, children }: { action: (form: FormData) => Promise<unknown>; children: React.ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [state, submit, pending] = useActionState(async (_: unknown, form: FormData) => {
    const typed: Snapshot = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') typed[k] = v;
    const result = await action(form);
    return result && typeof result === 'object' && 'error' in result ? { ...(result as object), typed } : result;
  }, null);
  const error = state && typeof state === 'object' && 'error' in state ? String(state.error) : null;
  const notice = state && typeof state === 'object' && 'notice' in state ? String(state.notice) : null;
  const typed = state && typeof state === 'object' && 'typed' in state ? (state.typed as Snapshot) : null;

  useEffect(() => {
    if (!error) return;
    const form = formRef.current;
    if (form && typed) {
      for (const [name, value] of Object.entries(typed)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || el.type === '')) || el instanceof HTMLSelectElement) el.value = value;
      }
    }
    alertRef.current?.focus();
  }, [error, typed]);

  return (
    <form action={submit} ref={formRef}>
      {error && (
        <p role="alert" tabIndex={-1} ref={alertRef}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
        {children}
      </fieldset>
    </form>
  );
}
