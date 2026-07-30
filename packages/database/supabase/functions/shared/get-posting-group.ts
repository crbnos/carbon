import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../lib/types.ts";

export async function getDefaultPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string
) {
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
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"] | null,
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
  }
): { account: string; description: string } {
  return replenishmentSystem === "Make" || replenishmentSystem === "Buy and Make"
    ? {
        account: accountDefaults.finishedGoodsAccount,
        description: "Finished Goods Account",
      }
    : {
        account: accountDefaults.rawMaterialsAccount,
        description: "Raw Materials Account",
      };
}
