-- Commons' first migration (Phase 2, task 2.1). The generated half mirrors prisma/schema/commons.prisma (CI runs
-- `prisma migrate diff --from-migrations --to-schema --exit-code` to prove they agree; the sandbox cannot run
-- `migrate dev`, D-20); the hand-written half is what Prisma cannot say: the value CHECKs, the path CHECK, and the
-- append-only triggers on VoteEvent and EditHistory (task 2.2, Quorum D-19 pattern). The billing tables leave the
-- history here (D-20).

-- DropTable: billing was removed by the module manifest (D-18, D-20); its tables were still in the history.
ALTER TABLE "BillingAccount" DROP CONSTRAINT IF EXISTS "BillingAccount_orgId_fkey";
DROP TABLE IF EXISTS "BillingAccount";
DROP TABLE IF EXISTS "StripeEvent";

-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('visible', 'deleted', 'removed');

-- CreateEnum
CREATE TYPE "VoteOutcome" AS ENUM ('APPLIED', 'TOGGLED_OFF', 'SWITCHED', 'SELF_VOTE', 'GATED_DOWNVOTE');

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bannedUntil" TIMESTAMPTZ(6),

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(6),
    "status" "NodeStatus" NOT NULL DEFAULT 'visible',
    "ups" INTEGER NOT NULL DEFAULT 1,
    "downs" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "parentId" UUID,
    "authorId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(6),
    "status" "NodeStatus" NOT NULL DEFAULT 'visible',
    "ups" INTEGER NOT NULL DEFAULT 1,
    "downs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "castAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "castAt" TIMESTAMPTZ(6) NOT NULL,
    "outcome" "VoteOutcome" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "VoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeSignal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "voterCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrigadeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditHistory" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "editorId" UUID NOT NULL,
    "previousBody" TEXT NOT NULL,
    "editedAt" TIMESTAMPTZ(6) NOT NULL,
    "withinWindow" BOOLEAN NOT NULL,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeKind" "NodeKind" NOT NULL,
    "nodeId" UUID NOT NULL,
    "rankedAt" TIMESTAMPTZ(6) NOT NULL,
    "hot" DOUBLE PRECISION NOT NULL,
    "best" DOUBLE PRECISION NOT NULL,
    "net" INTEGER NOT NULL,
    "ups" INTEGER NOT NULL,
    "downs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_orgId_userId_key" ON "Profile"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_orgId_handle_key" ON "Profile"("orgId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Board_orgId_slug_key" ON "Board"("orgId", "slug");

-- CreateIndex
CREATE INDEX "Post_boardId_createdAt_idx" ON "Post"("boardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_orgId_publicId_key" ON "Post"("orgId", "publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_orgId_publicId_key" ON "Comment"("orgId", "publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_postId_path_key" ON "Comment"("postId", "path");

-- CreateIndex
CREATE INDEX "Vote_nodeKind_nodeId_idx" ON "Vote"("nodeKind", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_voterId_nodeKind_nodeId_key" ON "Vote"("voterId", "nodeKind", "nodeId");

-- CreateIndex
CREATE INDEX "VoteEvent_nodeKind_nodeId_castAt_idx" ON "VoteEvent"("nodeKind", "nodeId", "castAt");

-- CreateIndex
CREATE INDEX "VoteEvent_orgId_castAt_idx" ON "VoteEvent"("orgId", "castAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeSignal_nodeKind_nodeId_windowStart_key" ON "BrigadeSignal"("nodeKind", "nodeId", "windowStart");

-- CreateIndex
CREATE INDEX "EditHistory_nodeKind_nodeId_editedAt_idx" ON "EditHistory"("nodeKind", "nodeId", "editedAt");

-- CreateIndex
CREATE INDEX "RankSnapshot_orgId_nodeKind_hot_idx" ON "RankSnapshot"("orgId", "nodeKind", "hot");

-- CreateIndex
CREATE UNIQUE INDEX "RankSnapshot_nodeKind_nodeId_key" ON "RankSnapshot"("nodeKind", "nodeId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeSignal" ADD CONSTRAINT "BrigadeSignal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written half (not modelled by Prisma; migrate diff ignores CHECKs and triggers).

-- A vote is +1 or -1; an absent Vote row is "no vote" (V-3 toggle-off deletes the row).
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_value_check" CHECK ("value" IN (1, -1));
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_value_check" CHECK ("value" IN (1, -1));
-- Counts never go negative.
ALTER TABLE "Post" ADD CONSTRAINT "Post_counts_check" CHECK ("ups" >= 0 AND "downs" >= 0 AND "commentCount" >= 0);
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_counts_check" CHECK ("ups" >= 0 AND "downs" >= 0);
-- ADR-001 / D-34: byte-order collation on path, so the (postId, path) unique btree serves LIKE-prefix subtree scans
-- and ORDER BY path without text_pattern_ops (which `prisma migrate diff` cannot round-trip). Prisma does not model
-- column collation, so this is invisible to the schema diff.
ALTER TABLE "Comment" ALTER COLUMN "path" TYPE TEXT COLLATE "C";
-- ADR-001: a path is a whole number of 6-char base-36 segments, and depth is derived from it.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_path_check" CHECK ("path" ~ '^([0-9a-z]{6})+$' AND "depth" = length("path") / 6 - 1);
-- A root comment has an empty parent; a reply has one.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parent_depth_check" CHECK (("parentId" IS NULL) = ("depth" = 0));

-- Append-only (task 2.2, Quorum D-19 pattern; TRUNCATE is left alone so tests can empty the tables).
CREATE FUNCTION commons_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "VoteEvent_append_only"
  BEFORE UPDATE OR DELETE ON "VoteEvent"
  FOR EACH ROW EXECUTE FUNCTION commons_append_only();

CREATE TRIGGER "EditHistory_append_only"
  BEFORE UPDATE OR DELETE ON "EditHistory"
  FOR EACH ROW EXECUTE FUNCTION commons_append_only();
