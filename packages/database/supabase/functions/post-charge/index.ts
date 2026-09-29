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
