-- Adult pairings an account chose to hide; an explicit hide always wins over learned preferences.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adultHiddenPairings" TEXT[] DEFAULT ARRAY[]::TEXT[];
