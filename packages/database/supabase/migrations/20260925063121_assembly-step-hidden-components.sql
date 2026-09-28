-- Per-step hidden components: nodeIds (same id space as "componentNodeIds")
-- the author hides on THIS step only — tooling, fixtures, or installed parts
-- blocking the view. Applied by the 3D player in the ERP editor and in MES.
-- Never contains the step's own "componentNodeIds" (stripped on write).
ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "hiddenComponentNodeIds" TEXT[] NOT NULL DEFAULT '{}';

-- The one place the rule "a step never hides its own parts" is enforced: every
-- write (hide/show, adding components, reassigning, version copy, regenerate)
-- strips the step's "componentNodeIds" out of its hidden list and dedupes it.
CREATE OR REPLACE FUNCTION assembly_step_strip_own_hidden_components()
RETURNS TRIGGER AS $$
BEGIN
  IF cardinality(NEW."hiddenComponentNodeIds") > 0 THEN
    NEW."hiddenComponentNodeIds" := ARRAY(
      SELECT DISTINCT hidden
      FROM unnest(NEW."hiddenComponentNodeIds") AS hidden
      WHERE hidden <> ALL (NEW."componentNodeIds")
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assembly_step_strip_own_hidden_components_trigger
  BEFORE INSERT OR UPDATE OF "hiddenComponentNodeIds", "componentNodeIds"
  ON "assemblyInstructionStep"
  FOR EACH ROW
  EXECUTE FUNCTION assembly_step_strip_own_hidden_components();
