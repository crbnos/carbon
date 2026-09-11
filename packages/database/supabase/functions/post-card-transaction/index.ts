import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { handlePostCardTransaction } from "./handler.ts";
import { postCardTransactionTransaction } from "./post-card-transaction-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve((req: Request) =>
  handlePostCardTransaction(
    req,
    (args) => postCardTransactionTransaction(db, args),
  )
);
