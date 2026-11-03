-- PRD 6.2 (D-87): the author's description of an attachment. NULL = legacy row, '' = decorative, else the alt text.
ALTER TABLE "Upload" ADD COLUMN "alt" TEXT;
-- "upload" joins ACTIONS, so its sliding-window hits need a place in LimitHit (the PRD's "no migration" missed this check).
ALTER TABLE "LimitHit" DROP CONSTRAINT "LimitHit_action_check";
ALTER TABLE "LimitHit" ADD CONSTRAINT "LimitHit_action_check" CHECK ("action" IN ('post', 'comment', 'vote', 'report', 'upload'));
