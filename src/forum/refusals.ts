// The door's typed refusals, said plainly (4.1.4). Pure: no Next, no database, so the copy is unit-tested. The code
// stays in parentheses so a tester can grep for it; numbers (retryAfter, the ban's lift time) are never dropped.
import { RateLimited } from './actions';
import { ForumRefused } from './db';
import { NotModerator, TransitionInvalid } from './moderation';

export const whenUtc = (d: Date): string => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const detailOf = (e: ForumRefused): string => e.message.replace(new RegExp(`^${e.code}: `), '');

/** The sentence for a refusal the pages can show, or null when the caller must answer differently (UNKNOWN_NODE → not found; unknown errors rethrow). */
export function refusalText(e: unknown): string | null {
  if (e instanceof RateLimited) return `Slow down: too many ${e.action}s. Try again in ${e.retryAfter} s. (RATE_LIMITED)`;
  if (e instanceof TransitionInvalid) return `That action is not allowed from the current state: ${e.from} → ${e.to}. (TRANSITION_INVALID)`;
  if (e instanceof NotModerator) return 'Only moderators can do that. (NOT_MODERATOR)';
  if (!(e instanceof ForumRefused)) return null;
  const detail = detailOf(e);
  switch (e.code) {
    case 'UNKNOWN_NODE':
      return null;
    case 'BANNED_UNTIL': {
      const until = Number(detail);
      return `Your account is banned until ${Number.isFinite(until) ? whenUtc(new Date(until * 1000)) : 'further notice'}. (BANNED_UNTIL)`;
    }
    case 'NOT_MEMBER':
      return 'You are not a member of this forum. (NOT_MEMBER)';
    case 'INPUT_INVALID':
      return `Check the form: ${detail}. (INPUT_INVALID)`;
    case 'TREE_INVALID':
      return 'That reply target does not belong to this thread. (TREE_INVALID)';
    case 'PARENT_REMOVED':
      return 'You cannot reply under a comment a moderator removed. (PARENT_REMOVED)';
    case 'THREAD_LOCKED':
      return 'This thread is locked. (THREAD_LOCKED)';
    case 'NOT_AUTHOR':
      return 'Only the author can do that. (NOT_AUTHOR)';
    case 'WRITE_ONCE':
      return `${detail} (WRITE_ONCE)`;
  }
}
