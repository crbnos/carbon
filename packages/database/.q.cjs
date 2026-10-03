const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DB });
(async () => { await c.connect();
const j = await c.query(`SELECT status, "updatedAt" FROM journal WHERE id=$1`, [process.argv[2]]);
console.log(j.rows[0]);
const l = await c.query(`SELECT id, description, amount, "createdBy" IS NOT NULL AS has_created_by, "createdAt" FROM "journalLine" WHERE "journalId"=$1 ORDER BY "createdAt", id`, [process.argv[2]]);
console.table(l.rows.map(r => ({...r, createdAt: r.createdAt.toISOString()}))); await c.end(); })();
