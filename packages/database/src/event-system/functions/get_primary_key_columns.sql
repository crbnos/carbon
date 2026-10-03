CREATE OR REPLACE FUNCTION public.get_primary_key_columns(p_table_name text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  pk_columns TEXT[];
BEGIN
  -- All columns of the primary key
  SELECT array_agg(a.attname ORDER BY a.attnum) INTO pk_columns
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    AND i.indisprimary;

  -- No PK: key columns of the smallest valid, non-partial, non-expression
  -- unique index. Partial/expression indexes don't guarantee row identity for
  -- every row, and INCLUDE columns (positions past indnkeyatts) aren't part of
  -- the uniqueness constraint — the slice keeps key columns only.
  IF pk_columns IS NULL THEN
    SELECT array_agg(a.attname ORDER BY a.attnum) INTO pk_columns
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid
      AND a.attnum = ANY ((i.indkey::int2[])[1:i.indnkeyatts])
    WHERE i.indexrelid = (
      SELECT i2.indexrelid
      FROM pg_index i2
      WHERE i2.indrelid = ('"' || p_table_name || '"')::regclass
        AND i2.indisunique
        AND i2.indisvalid
        AND i2.indpred IS NULL
        AND i2.indexprs IS NULL
      ORDER BY i2.indnkeyatts ASC
      LIMIT 1
    );
  END IF;

  -- Last resort: the legacy single-column resolver
  IF pk_columns IS NULL OR array_length(pk_columns, 1) IS NULL THEN
    pk_columns := ARRAY[public.get_primary_key_column(p_table_name)];
  END IF;

  RETURN pk_columns;
END;
$function$;
