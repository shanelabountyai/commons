-- 4.1.11 (D-48, D-66): granting and revoking the moderator flag are logged moderation actions.
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_kind_check";
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_kind_check" CHECK ("kind" IN ('REMOVE', 'RESTORE', 'CLEAR', 'REOPEN', 'LOCK', 'UNLOCK', 'PIN', 'UNPIN', 'WARN', 'BAN', 'UNBAN', 'REVIEW_SIGNAL', 'GRANT_MOD', 'REVOKE_MOD'));
