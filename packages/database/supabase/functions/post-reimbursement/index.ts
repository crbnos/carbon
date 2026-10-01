// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { handlePostReimbursement } from "./handler.ts";
import { postReimbursementTransaction } from "./post-reimbursement-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve((req: Request) =>
  handlePostReimbursement(
    req,
    (args) => postReimbursementTransaction(db, args),
  )
);
