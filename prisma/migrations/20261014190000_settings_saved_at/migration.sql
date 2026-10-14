-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "settingsSavedAt" TIMESTAMP(3);


-- Shops that already moved off the defaults have clearly set their days.
UPDATE "Shop" SET "settingsSavedAt" = "updatedAt"
 WHERE "handlingDays" <> 1 OR "transitDays" <> 3 OR "skipWeekends" = false;
