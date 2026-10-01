// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { handlePostCharge } from "./handler.ts";
import { postChargeTransaction } from "./post-charge-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve((req: Request) =>
  handlePostCharge(
    req,
    (args) => postChargeTransaction(db, args),
  )
);
