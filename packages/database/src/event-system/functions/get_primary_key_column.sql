CREATE OR REPLACE FUNCTION public.get_primary_key_column(p_table_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  pk_column TEXT;
BEGIN
  -- First try to get primary key
  SELECT a.attname INTO pk_column
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    AND i.indisprimary
  LIMIT 1;
  
  -- If no primary key, try to get any unique index column
  IF pk_column IS NULL THEN
    SELECT a.attname INTO pk_column
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    LIMIT 1;
  END IF;
  
  RETURN COALESCE(pk_column, 'id');
END;
$function$;
