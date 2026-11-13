-- Each company's audit log table keeps the read policy secure_audit_log_table
-- wrote when it was made. Write it again with the Audit Logs page, now that
-- 20261111050000 ships the version of secure_audit_log_table that names it.
-- Re-running is safe: the function drops the policy before it creates it.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'auditLog\_%' ESCAPE '\'
  LOOP
    PERFORM secure_audit_log_table(substring(t FROM length('auditLog_') + 1));
  END LOOP;
END $$;
