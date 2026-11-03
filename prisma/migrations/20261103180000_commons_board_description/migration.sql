-- PRD 6.3 (D-90): a board says what belongs on it. '' = none; no backfill (the copy is seed data in src/forum/load.ts).
ALTER TABLE "Board" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
