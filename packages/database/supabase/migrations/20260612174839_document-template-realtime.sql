-- Surface documentTemplate writes over realtime so the layout editor can warn
-- when another user saves the same template while you're editing it. Default
-- replica identity (primary key) is enough — the editor only reads the new
-- row's documentType/updatedBy from the payload.
ALTER PUBLICATION supabase_realtime ADD TABLE "documentTemplate";
