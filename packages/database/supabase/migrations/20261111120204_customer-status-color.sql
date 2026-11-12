-- A status's badge color, one of the `Color` names in @carbon/utils. NULL keeps
-- the color derived from the name.
ALTER TABLE "customerStatus"
  ADD COLUMN "color" TEXT,
  ADD CONSTRAINT "customerStatus_color_check" CHECK (
    "color" IN ('gray', 'lightGray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')
  );
