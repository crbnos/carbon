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
import { postChargeTransaction } from "./post-charge-transaction";

export const postChargeInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  chargeId: z.string()
});

/**
 * `postCharge` for app code that holds a Supabase client: a service-role client
 * runs it as the system, any other client is permission-checked (`callerContext`).
 */
export async function postChargeAs(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: z.input<typeof postChargeInput> & { companyId: string; userId: string }
) {
  const { companyId, userId } = input;
  return postCharge(
    await callerContext(client, { db, companyId, userId }),
    input
  );
}

/**
 * Posts or voids a charge and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
export function postCharge(
  ctx: OperationContext,
  input: z.input<typeof postChargeInput>
) {
  return runOperation("post-charge", async () => {
    const { type, chargeId } = postChargeInput.parse(input);
    const { db, companyId, userId } = ctx;
    await assertOperationPermissions(ctx, { update: "invoicing" });
    const result = await postChargeTransaction(db, {
      type,
      chargeId,
      companyId,
      userId
    });
    return { success: true, ...result };
  });
}
