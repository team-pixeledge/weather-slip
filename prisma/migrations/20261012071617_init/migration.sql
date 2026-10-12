-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO');

-- CreateEnum
CREATE TYPE "TemperatureUnit" AS ENUM ('C', 'F', 'BOTH');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('OK', 'PENDING_DATES', 'NO_LOCATION', 'LIMIT_REACHED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobReason" AS ENUM ('CREATE', 'ADDRESS_CHANGE', 'REFRESH', 'PENDING_FILL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "unit" "TemperatureUnit" NOT NULL DEFAULT 'C',
    "showCurrent" BOOLEAN NOT NULL DEFAULT true,
    "showDispatch" BOOLEAN NOT NULL DEFAULT true,
    "showDelivery" BOOLEAN NOT NULL DEFAULT true,
    "showPrecip" BOOLEAN NOT NULL DEFAULT true,
    "showLocation" BOOLEAN NOT NULL DEFAULT true,
    "handlingDays" INTEGER NOT NULL DEFAULT 1,
    "transitDays" INTEGER NOT NULL DEFAULT 3,
    "skipWeekends" BOOLEAN NOT NULL DEFAULT true,
    "weatherApiKeyEnc" TEXT,
    "usagePeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "WeatherCache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrderWeatherSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SnapshotStatus" NOT NULL,
    "locationKey" TEXT,
    "city" TEXT,
    "countryCode" TEXT,
    "dispatchDate" TEXT,
    "deliveryDate" TEXT,
    "payload" JSONB,
    "summary" TEXT,
    "frozenAt" TIMESTAMP(3),
    "nextFillAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderWeatherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" "JobReason" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherCache_expiresAt_idx" ON "WeatherCache"("expiresAt");

-- CreateIndex
CREATE INDEX "OrderWeatherSnapshot_shop_createdAt_idx" ON "OrderWeatherSnapshot"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "OrderWeatherSnapshot_status_nextFillAt_idx" ON "OrderWeatherSnapshot"("status", "nextFillAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderWeatherSnapshot_shop_orderId_version_key" ON "OrderWeatherSnapshot"("shop", "orderId", "version");

-- CreateIndex
CREATE INDEX "WeatherJob_status_runAfter_idx" ON "WeatherJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "WeatherJob_shop_orderId_status_idx" ON "WeatherJob"("shop", "orderId", "status");

-- AddForeignKey
ALTER TABLE "OrderWeatherSnapshot" ADD CONSTRAINT "OrderWeatherSnapshot_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherJob" ADD CONSTRAINT "WeatherJob_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shop") ON DELETE CASCADE ON UPDATE CASCADE;
