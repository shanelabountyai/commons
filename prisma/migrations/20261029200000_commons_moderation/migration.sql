-- Phase 4, task 4.1: reports, cases, the append-only moderation log, duplicate signals, uploads, the moderator flag
-- (D-48), thread lock and pin, reviewedAt on brigade signals. Generated half mirrors prisma/schema/commons.prisma;
-- hand-written half: the closed vocabularies as CHECKs and the append-only trigger on ModerationAction.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "isModerator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "modState" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "lockedAt" TIMESTAMPTZ(6),
ADD COLUMN "pinnedAt" TIMESTAMPTZ(6),
ADD COLUMN "bodyHash" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "bodyHash" TEXT;

-- AlterTable
ALTER TABLE "BrigadeSignal" ADD COLUMN "reviewedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "nodeKind" "NodeKind",
    "nodeId" UUID,
    "subjectId" UUID,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateSignal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "matchKind" "NodeKind" NOT NULL,
    "matchId" UUID NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DuplicateSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "postId" UUID,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_orgId_bodyHash_createdAt_idx" ON "Post"("orgId", "bodyHash", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_orgId_bodyHash_createdAt_idx" ON "Comment"("orgId", "bodyHash", "createdAt");

-- CreateIndex
CREATE INDEX "Report_nodeKind_nodeId_idx" ON "Report"("nodeKind", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_nodeKind_nodeId_key" ON "Report"("reporterId", "nodeKind", "nodeId");

-- CreateIndex
CREATE INDEX "ModerationCase_orgId_state_openedAt_idx" ON "ModerationCase"("orgId", "state", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationCase_nodeKind_nodeId_key" ON "ModerationCase"("nodeKind", "nodeId");

-- CreateIndex
CREATE INDEX "ModerationAction_orgId_createdAt_idx" ON "ModerationAction"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_nodeKind_nodeId_idx" ON "ModerationAction"("nodeKind", "nodeId");

-- CreateIndex
CREATE INDEX "ModerationAction_subjectId_idx" ON "ModerationAction"("subjectId");

-- CreateIndex
CREATE INDEX "DuplicateSignal_orgId_reviewedAt_createdAt_idx" ON "DuplicateSignal"("orgId", "reviewedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DuplicateSignal_orgId_bodyHash_createdAt_idx" ON "DuplicateSignal"("orgId", "bodyHash", "createdAt");

-- CreateIndex
CREATE INDEX "Upload_postId_idx" ON "Upload"("postId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateSignal" ADD CONSTRAINT "DuplicateSignal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written half.

-- Closed vocabularies (rules/moderation.json). Changing one there means a migration here.
ALTER TABLE "Report" ADD CONSTRAINT "Report_reason_check" CHECK ("reason" IN ('spam', 'malware', 'harassment', 'doxxing', 'off_topic', 'duplicate', 'other'));
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_state_check" CHECK ("state" IN ('OPEN', 'REMOVED', 'CLEARED', 'RESTORED'));
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_modState_check" CHECK ("modState" IN ('ACTIVE', 'WARNED', 'BANNED'));
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_kind_check" CHECK ("kind" IN ('REMOVE', 'RESTORE', 'CLEAR', 'REOPEN', 'LOCK', 'UNLOCK', 'PIN', 'UNPIN', 'WARN', 'BAN', 'UNBAN', 'REVIEW_SIGNAL'));
-- An action is on a node or on a profile, never neither.
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_target_check" CHECK (("nodeId" IS NOT NULL AND "nodeKind" IS NOT NULL) OR "subjectId" IS NOT NULL);
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_bytes_check" CHECK ("bytes" > 0);

-- Append-only moderation log (Handhold's audit pattern, D-19; Quorum D-19 trigger shape).
CREATE TRIGGER "ModerationAction_append_only"
  BEFORE UPDATE OR DELETE ON "ModerationAction"
  FOR EACH ROW EXECUTE FUNCTION commons_append_only();
