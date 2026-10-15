// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Every write of the import runs through `inTransaction`. On the database it
// opens a transaction, as `db.transaction().execute` does. Inside a dry run the
// whole import already runs in one transaction that is rolled back at the end,
// and Postgres has no nested transactions: there each call is a savepoint, so a
// step that fails rolls back only its own writes, as its own transaction would.

import type { KyselyDatabase } from "@carbon/database/client";
import { ControlledTransaction, type Kysely, type Transaction } from "kysely";

let savepoints = 0;

export async function inTransaction<T>(
  db: Kysely<KyselyDatabase>,
  callback: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  if (!(db instanceof ControlledTransaction)) {
    return db.transaction().execute(callback);
  }
  savepoints += 1;
  const name = `import_step_${savepoints}`;
  const dryRun = db as ControlledTransaction<KyselyDatabase>;
  const savepoint = await dryRun.savepoint(name).execute();
  try {
    const result = await callback(
      savepoint as unknown as Transaction<KyselyDatabase>
    );
    await savepoint.releaseSavepoint(name).execute();
    return result;
  } catch (error) {
    await savepoint.rollbackToSavepoint(name).execute();
    throw error;
  }
}
