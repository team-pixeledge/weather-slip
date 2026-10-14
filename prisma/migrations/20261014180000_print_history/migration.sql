-- AlterTable
ALTER TABLE "PrintedOrder" ADD COLUMN     "printedAt" TIMESTAMP(3)[];


-- Backfill what's known: one print → its date; more → the first and latest.
UPDATE "PrintedOrder"
   SET "printedAt" = CASE
     WHEN "printCount" <= 1 OR "firstPrintedAt" = "lastPrintedAt" THEN ARRAY["lastPrintedAt"]
     ELSE ARRAY["firstPrintedAt", "lastPrintedAt"]
   END;
