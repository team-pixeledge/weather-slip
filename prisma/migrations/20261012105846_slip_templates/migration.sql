-- CreateEnum
CREATE TYPE "SlipTemplate" AS ENUM ('CLASSIC', 'MINIMAL', 'DETAILED', 'LABEL_4X6');

-- CreateEnum
CREATE TYPE "PaperSize" AS ENUM ('A4', 'LETTER');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "slipFooter" TEXT,
ADD COLUMN     "slipPaper" "PaperSize" NOT NULL DEFAULT 'A4',
ADD COLUMN     "slipShowBilling" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slipShowImages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slipShowNote" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slipShowSku" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slipTemplate" "SlipTemplate" NOT NULL DEFAULT 'CLASSIC';
