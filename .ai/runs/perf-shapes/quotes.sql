-- Quote list shapes: %s is the view, %L the company id.
INSERT INTO bench_shapes VALUES
  (1, 'page 50', 'SELECT * FROM %s WHERE "companyId" = %L ORDER BY "quoteId" DESC LIMIT 50'),
  (2, 'status filter', 'SELECT * FROM %s WHERE "companyId" = %L AND status = ''Sent'' ORDER BY "quoteId" DESC LIMIT 50'),
  (3, 'count', 'SELECT count(*) FROM %s WHERE "companyId" = %L'),
  (4, 'full read', 'SELECT * FROM %s WHERE "companyId" = %L'),
  (5, 'sort by lines', 'SELECT * FROM %s WHERE "companyId" = %L ORDER BY lines DESC NULLS LAST LIMIT 50'),
  (6, 'sort by dueDate', 'SELECT * FROM %s WHERE "companyId" = %L ORDER BY "dueDate" DESC NULLS LAST LIMIT 50');
