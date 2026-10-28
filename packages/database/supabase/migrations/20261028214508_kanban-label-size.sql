-- The size a kanban label prints at: a letter sheet of six, or one card per
-- 4" x 2" or 3" x 2" thermal label. The ids match @carbon/utils labelSizes.
CREATE TYPE "kanbanLabelSize" AS ENUM ('letter', 'label4x2', 'label3x2');

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "kanbanLabelSize" "kanbanLabelSize" NOT NULL DEFAULT 'letter';
