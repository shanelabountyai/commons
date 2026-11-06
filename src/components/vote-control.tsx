// PRD 5.1 (D-77): the vote control — outside any panel, the viewer's vote as aria-pressed and as text (not colour
// alone), the author's fixed +1 in words (D-12), and ▼'s accessible name naming the gate for a young account.
// Server component; the form is ForumForm, so the outcome notice ({notice} with its code, 4.1.7) shows in place.
import { ForumForm } from './forum-form';

export function VoteControl({
  action,
  postId,
  commentId,
  label,
  mine,
  isAuthor,
  gateNote,
}: {
  action: (form: FormData) => Promise<unknown>;
  postId: string;
  commentId?: string;
  /** "post" or "comment by <handle>" — the button names are "Upvote <label>" and "Downvote <label>". */
  label: string;
  mine: 1 | -1 | 0;
  isAuthor: boolean;
  gateNote: string | null;
}) {
  if (isAuthor) return <span className="vote-control meta">+1 (yours, fixed)</span>;
  return (
    <span className="vote-control">
      <ForumForm action={action}>
        <input type="hidden" name="postId" value={postId} />
        {commentId && <input type="hidden" name="commentId" value={commentId} />}
        <button type="submit" name="value" value="1" aria-pressed={mine === 1} aria-label={`Upvote ${label}`}>
          ▲{mine === 1 && <span className="vote-state">upvoted</span>}
        </button>
        <button type="submit" name="value" value="-1" aria-pressed={mine === -1} aria-label={`Downvote ${label}${gateNote ? ` (${gateNote})` : ''}`}>
          ▼{mine === -1 && <span className="vote-state">downvoted</span>}
        </button>
      </ForumForm>
    </span>
  );
}
