-- A kanban's number is printed on its card, so it never changes once set.
-- A NULL number (a row restored from a backup taken before kanban numbers)
-- may still be filled; sync_advance_document_sequence then moves the counter
-- past it.
CREATE OR REPLACE FUNCTION prevent_kanban_readable_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."kanbanId" IS NOT NULL
    AND NEW."kanbanId" IS DISTINCT FROM OLD."kanbanId"
  THEN
    RAISE EXCEPTION 'Kanban % keeps its number: it is printed on the card', OLD."kanbanId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS prevent_kanban_readable_id_change ON "kanban";
CREATE TRIGGER prevent_kanban_readable_id_change
  BEFORE UPDATE OF "kanbanId" ON "kanban"
  FOR EACH ROW
  EXECUTE PROCEDURE prevent_kanban_readable_id_change();
