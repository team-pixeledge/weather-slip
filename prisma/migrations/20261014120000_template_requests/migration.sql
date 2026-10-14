-- CreateEnum
CREATE TYPE "TemplateRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'DONE', 'DECLINED');

-- CreateTable
CREATE TABLE "TemplateRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "referenceUrl" TEXT,
    "contactEmail" TEXT NOT NULL,
    "status" "TemplateRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateRequest_shop_createdAt_idx" ON "TemplateRequest"("shop", "createdAt");

-- AddForeignKey
ALTER TABLE "TemplateRequest" ADD CONSTRAINT "TemplateRequest_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

