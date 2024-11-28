CREATE TRIGGER create_tool_make_method_related_records
  AFTER INSERT on public.tool
  FOR EACH ROW EXECUTE PROCEDURE public.create_make_method_related_records();