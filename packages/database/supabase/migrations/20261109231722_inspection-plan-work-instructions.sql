-- An inspection plan's work instructions: rich text (the Tiptap JSON a method
-- operation's `workInstruction` holds) the inspector reads on every lot of the
-- plan. A lot reads it live, as it reads the plan's parameters.

ALTER TABLE "inspectionDocument" ADD COLUMN "workInstruction" JSONB;
