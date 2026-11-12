-- A service job's problem is rich text, like its findings and resolution: a
-- TipTap document in JSONB. Existing text becomes one paragraph per line, the
-- same document `textToRichTextDoc` (@carbon/utils) builds. Blank text becomes
-- NULL. The RMA line's `problem` stays TEXT: it is a short field, converted
-- when a receipt opens the job.

-- ALTER COLUMN ... USING cannot hold a subquery, so the conversion lives in a
-- function for the length of this migration.
CREATE FUNCTION pg_temp.service_job_problem_doc(input TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN input IS NULL OR btrim(input, E' \t\r\n') = '' THEN NULL
    ELSE jsonb_build_object(
      'type', 'doc',
      'content', (
        SELECT jsonb_agg(
          CASE
            WHEN line = '' THEN jsonb_build_object('type', 'paragraph')
            ELSE jsonb_build_object(
              'type', 'paragraph',
              'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', line)
              )
            )
          END
          ORDER BY n
        )
        FROM regexp_split_to_table(btrim(input, E' \t\r\n'), E'\r?\n')
          WITH ORDINALITY AS lines(line, n)
      )
    )
  END
$$;

ALTER TABLE "serviceJob"
  ALTER COLUMN "problem" TYPE JSONB
  USING pg_temp.service_job_problem_doc("problem");
