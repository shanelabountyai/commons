// The two React wrappers over the sanitizer (task 4.3). They live in src/render because they are the only place a
// string becomes DOM (engine:lint: dangerouslySetInnerHTML outside src/render is refused).
import { renderMarkdown, renderText } from './index';

/** Markdown bodies (posts, comments). */
export function Markdown({ body }: { body: string }) {
  return <div className="body" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />;
}

/** Plain-text fields (titles, handles, board titles): one policy, one lint rule. */
export function Text({ value }: { value: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderText(value) }} />;
}
