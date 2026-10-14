-- CreateTable
CREATE TABLE "PrintedOrder" (
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "firstPrintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPrintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PrintedOrder_pkey" PRIMARY KEY ("shop","orderId")
);

-- AddForeignKey
ALTER TABLE "PrintedOrder" ADD CONSTRAINT "PrintedOrder_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shop") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill. Before per-print charging went live (083a98f, production at
-- 2026-10-14 10:50:24 UTC) every CountedOrder row came from a print; since
-- then prints set lastPrintedAt and Flow's markCounted rows leave it null.
INSERT INTO "PrintedOrder" ("shop", "orderId", "firstPrintedAt", "lastPrintedAt", "printCount")
SELECT "shop", "orderId", "countedAt", COALESCE("lastPrintedAt", "countedAt"), 1
  FROM "CountedOrder"
 WHERE "lastPrintedAt" IS NOT NULL
    OR "countedAt" < '2026-10-14 10:50:24'
ON CONFLICT DO NOTHING;
