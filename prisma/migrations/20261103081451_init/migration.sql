-- CreateEnum
CREATE TYPE "Seat" AS ENUM ('EXPERT', 'DESK');

-- CreateEnum
CREATE TYPE "PackageTier" AS ENUM ('FREE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "work" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country" TEXT NOT NULL DEFAULT 'PK',
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "package" "PackageTier" NOT NULL DEFAULT 'FREE',
    "seat" "Seat" NOT NULL DEFAULT 'EXPERT',
    "googleId" TEXT,
    "facebookId" TEXT,
    "fingerprintEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "faceEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "refreshTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_googleId_key" ON "accounts"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_facebookId_key" ON "accounts"("facebookId");
