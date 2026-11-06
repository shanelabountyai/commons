-- PRD 5.2 (D-75): RING and AGED_BRIGADE share D-31's signal table; existing rows are BRIGADE.
CREATE TYPE "SignalKind" AS ENUM ('BRIGADE', 'RING', 'AGED_BRIGADE');
ALTER TABLE "BrigadeSignal" ADD COLUMN "kind" "SignalKind" NOT NULL DEFAULT 'BRIGADE';
DROP INDEX "BrigadeSignal_nodeKind_nodeId_windowStart_key";
CREATE UNIQUE INDEX "BrigadeSignal_kind_nodeKind_nodeId_windowStart_key" ON "BrigadeSignal"("kind", "nodeKind", "nodeId", "windowStart");
