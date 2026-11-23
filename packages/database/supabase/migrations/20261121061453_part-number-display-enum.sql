-- Which part numbers a document line prints: ours, the other party's, or both
-- in either order. "Theirs" is the customer on a sales document and the
-- supplier on a purchasing document. Spec: .ai/specs/2026-11-19-part-number-display.md.
DO $$
BEGIN
  CREATE TYPE "partNumberDisplay" AS ENUM (
    'Ours First',
    'Theirs First',
    'Theirs Only',
    'Ours Only'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
