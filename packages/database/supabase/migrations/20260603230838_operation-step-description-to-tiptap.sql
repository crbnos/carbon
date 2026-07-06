-- Some operation-step `description` values are stored as jsonb scalar strings
-- (e.g. "Frame cube...\n...") instead of tiptap doc objects {"type":"doc","content":[...]}.
-- The Supabase client returns those as JS strings and re-inserting them into a jsonb
-- column breaks method copies (get-method edge function: invalid input syntax for json).
-- Convert every scalar-string description into a tiptap doc, splitting on newlines into
-- paragraphs (blank line -> bare paragraph, matching @carbon/utils textToTiptap).

do $$
declare
  tbl text;
begin
  foreach tbl in array array['methodOperationStep', 'jobOperationStep', 'quoteOperationStep']
  loop
    execute format($fmt$
      update %I s
      set description = jsonb_build_object('type', 'doc', 'content', (
        select coalesce(jsonb_agg(
          case when line = '' then jsonb_build_object('type', 'paragraph')
          else jsonb_build_object('type', 'paragraph', 'content',
            jsonb_build_array(jsonb_build_object('type', 'text', 'text', line))) end
        ), '[]'::jsonb)
        from regexp_split_to_table(s.description #>> '{}', E'\n') as line))
      where jsonb_typeof(to_jsonb(s.description)) = 'string'
    $fmt$, tbl);
  end loop;
end $$;
