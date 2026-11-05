-- PRD 7.3 (D-104): the link window's history is LimitHit rows with action 'link' (reverses D-100 (4)). The PRD said
-- no migration because the column is a String; the CHECK below (6.2 precedent) was missed, so the set is widened here.
ALTER TABLE "LimitHit" DROP CONSTRAINT "LimitHit_action_check";
ALTER TABLE "LimitHit" ADD CONSTRAINT "LimitHit_action_check" CHECK ("action" IN ('post', 'comment', 'vote', 'report', 'upload', 'link'));
