ALTER TYPE "ContentType" ADD VALUE 'TEXT';

ALTER TABLE "Content"
ADD COLUMN "textContent" TEXT;
