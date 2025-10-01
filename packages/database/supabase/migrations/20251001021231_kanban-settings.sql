CREATE TYPE "kanbanOutput" AS ENUM ('label', 'qrcode', 'url');

ALTER TABLE "companySettings" ADD COLUMN "kanbanOutput" "kanbanOutput" NOT NULL DEFAULT 'qrcode';

