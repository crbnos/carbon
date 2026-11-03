-- Shapes for the sales invoice list and its whole-set readers.
INSERT INTO bench_shapes VALUES
  (1, 'page 50, sorted by invoiceId', 'SELECT * FROM %s WHERE "companyId" = %L ORDER BY "invoiceId" DESC LIMIT 50'),
  (2, 'page 50, status = Overdue', 'SELECT * FROM %s WHERE "companyId" = %L AND status = ''Overdue'' ORDER BY "invoiceId" DESC LIMIT 50'),
  (3, 'exact count', 'SELECT count(*) FROM %s WHERE "companyId" = %L'),
  (4, 'full read (payment application)', 'SELECT * FROM %s WHERE "companyId" = %L'),
  (5, 'open with balance > 0', 'SELECT id, balance FROM %s WHERE "companyId" = %L AND balance > 0'),
  (6, 'page 50, sorted by balance', 'SELECT * FROM %s WHERE "companyId" = %L ORDER BY balance DESC LIMIT 50');
