import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  assertOperationPermissions,
  callerContext,
  type OperationContext
} from "../context";
import { runOperation } from "../result";
import { postReimbursementTransaction } from "./post-reimbursement-transaction";

export const postReimbursementInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  reimbursementId: z.string()
});

/**
 * `postReimbursement` for app code that holds a Supabase client: a service-role client
 * runs it as the system, any other client is permission-checked (`callerContext`).
 */
export async function postReimbursementAs(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: z.input<typeof postReimbursementInput> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId } = input;
  return postReimbursement(
    await callerContext(client, { db, companyId, userId }),
    input
  );
}

/**
 * Posts or voids a reimbursement and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
export function postReimbursement(
  ctx: OperationContext,
  input: z.input<typeof postReimbursementInput>
) {
  return runOperation("post-reimbursement", async () => {
    const { type, reimbursementId } = postReimbursementInput.parse(input);
    const { db, companyId, userId } = ctx;
    await assertOperationPermissions(ctx, { update: "invoicing" });
    const result = await postReimbursementTransaction(db, {
      type,
      reimbursementId,
      companyId,
      userId
    });
    return { success: true, ...result };
  });
}
