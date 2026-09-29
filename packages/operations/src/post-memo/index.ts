import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  assertOperationPermissions,
  callerContext,
  type OperationContext,
  serviceRoleClient
} from "../context";
import { runOperation } from "../result";
import { postMemoTransaction } from "./post-memo-transaction";

export const postMemoInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string()
});

/**
 * `postMemo` for app code that holds a Supabase client: a service-role client
 * runs it as the system, any other client is permission-checked (`callerContext`).
 */
export async function postMemoAs(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: z.input<typeof postMemoInput> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId } = input;
  return postMemo(
    await callerContext(client, { db, companyId, userId }),
    input
  );
}

/** Posts or voids a credit/debit memo and its journal, atomically. */
export function postMemo(
  ctx: OperationContext,
  input: z.input<typeof postMemoInput>
) {
  return runOperation("post-memo", async () => {
    const { type, memoId } = postMemoInput.parse(input);
    const { db, companyId, userId } = ctx;
    await assertOperationPermissions(ctx, { update: "invoicing" });
    const client = await serviceRoleClient();
    const today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();

    const result = await postMemoTransaction(db, {
      type,
      memoId,
      userId,
      companyId,
      today,
      client
    });
    return { success: true, ...result };
  });
}
