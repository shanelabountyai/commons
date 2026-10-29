-- D-56: a total order for the append-only log. createdAt is epoch seconds (D-7); two actions inside one second
-- (remove, then restore) must still read in the order they happened. BIGSERIAL assigns in insertion order; the
-- append-only trigger does not fire on ALTER, and existing rows are numbered in physical order (one at a time here).
ALTER TABLE "ModerationAction" ADD COLUMN "seq" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "ModerationAction_seq_key" ON "ModerationAction"("seq");
