-- Phase 3, task 3.4 (D-39): the sliding-window store. Generated half mirrors prisma/schema/commons.prisma LimitHit.

-- CreateTable
CREATE TABLE "LimitHit" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LimitHit_profileId_action_at_idx" ON "LimitHit"("profileId", "action", "at");

-- CreateIndex
CREATE INDEX "LimitHit_at_idx" ON "LimitHit"("at");

-- AddForeignKey
ALTER TABLE "LimitHit" ADD CONSTRAINT "LimitHit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LimitHit" ADD CONSTRAINT "LimitHit_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written half: the action vocabulary is closed (rules/limits.json windows).
ALTER TABLE "LimitHit" ADD CONSTRAINT "LimitHit_action_check" CHECK ("action" IN ('post', 'comment', 'vote', 'report'));
