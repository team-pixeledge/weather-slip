-- CreateTable
CREATE TABLE "CountedOrder" (
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountedOrder_pkey" PRIMARY KEY ("shop","orderId")
);

-- AddForeignKey
ALTER TABLE "CountedOrder" ADD CONSTRAINT "CountedOrder_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- Orders that already received weather under the old "count every new
-- order" rule were counted then; record them so printing doesn't count them
-- a second time.
INSERT INTO "CountedOrder" ("shop", "orderId", "countedAt")
SELECT "shop", "orderId", MIN("createdAt")
  FROM "OrderWeatherSnapshot"
 WHERE "status" IN ('OK', 'PENDING_DATES')
 GROUP BY "shop", "orderId"
ON CONFLICT DO NOTHING;
