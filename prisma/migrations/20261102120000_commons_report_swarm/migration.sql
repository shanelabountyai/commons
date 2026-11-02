-- PRD 5.4 B (D-31): a report swarm is one row per (author, window) with the reporters kept so the queue can name them.
CREATE TABLE "ReportSwarmSignal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "reporterCount" INTEGER NOT NULL,
    "reporterIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ReportSwarmSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSwarmSignal_orgId_reviewedAt_createdAt_idx" ON "ReportSwarmSignal"("orgId", "reviewedAt", "createdAt");
CREATE UNIQUE INDEX "ReportSwarmSignal_subjectId_windowStart_key" ON "ReportSwarmSignal"("subjectId", "windowStart");

ALTER TABLE "ReportSwarmSignal" ADD CONSTRAINT "ReportSwarmSignal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSwarmSignal" ADD CONSTRAINT "ReportSwarmSignal_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
