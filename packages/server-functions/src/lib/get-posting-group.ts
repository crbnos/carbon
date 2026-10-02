// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type AnyPostgresClient,
  type Database,
  isKysely
} from "@carbon/database";
import { single } from "@carbon/database/rows";

/** The company's posting accounts. Pass `db` (or `trx`); a Supabase client still works. */
export async function getDefaultPostingGroup(
  client: AnyPostgresClient,
  companyId: string
) {
  if (isKysely(client)) {
    return await single(client, "accountDefault", { companyId });
  }
  return await client
    .from("accountDefault")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

// Buy → Raw Materials; Make / Buy and Make → Finished Goods. The rule is a
// stable property of the item so the debit side (receipt/job completion) and
// the credit side (shipment/issue/invoice) always hit the same account.
export function resolveInventoryAccount(
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null,
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
  }
): { account: string; description: string } {
  return replenishmentSystem === "Make" ||
    replenishmentSystem === "Buy and Make"
    ? {
        account: accountDefaults.finishedGoodsAccount,
        description: "Finished Goods Account"
      }
    : {
        account: accountDefaults.rawMaterialsAccount,
        description: "Raw Materials Account"
      };
}
