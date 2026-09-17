import type { Database } from "../lib/types.ts";

type Account = Pick<Database["public"]["Tables"]["account"]["Row"],
  "id" | "name" | "companyGroupId" | "active" | "isGroup" | "class" | "incomeBalance" | "accountType" | "consolidatedRate" | "parentId">;

export function resolveShippingDefault({ parentDefaultId, accounts, companyGroupId }: {
  parentDefaultId: string | null;
  accounts: readonly Account[];
  companyGroupId: string;
}): string {
  const eligible = (account: Account) => account.companyGroupId === companyGroupId &&
    account.active === true && account.isGroup === false &&
    account.class === "Revenue" && account.incomeBalance === "Income Statement";
  const mapped = accounts.find((account) => account.id === parentDefaultId);
  if (mapped && eligible(mapped)) return mapped.id;

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const candidates = accounts.filter((account) => {
    const parent = account.parentId ? byId.get(account.parentId) : undefined;
    return eligible(account) && account.name === "Shipping Revenue" &&
      account.accountType === "Income" && account.consolidatedRate === "Average" &&
      parent?.companyGroupId === companyGroupId && parent.active === true &&
      parent.isGroup === true && parent.class === "Revenue" &&
      parent.accountType === "Income" && parent.incomeBalance === "Income Statement";
  });
  if (candidates.length !== 1) {
    throw new Error("A unique compatible Shipping Revenue default is required for this company group");
  }
  return candidates[0].id;
}
