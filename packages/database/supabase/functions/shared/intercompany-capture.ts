export type IntercompanyPostingLine = {
  id: string;
  accountId?: string | null;
  amount?: number | null;
  quantity?: number | null;
};

export type IntercompanyPostingRole =
  | "Control"
  | "Revenue"
  | "COGS"
  | "Capitalization";

export function classifyIntercompanyPostingLines(
  lines: IntercompanyPostingLine[],
  metadata: Array<{ itemId?: string | null }>,
  accounts: {
    controlAccountId: string | null | undefined;
    revenueAccountIds?: readonly string[];
    cogsAccountId?: string | null;
    capitalizationAccountIds?: readonly string[];
  },
): Array<{
  journalLineId: string;
  accountId: string;
  amount: number;
  quantity: number | null;
  itemId: string | null;
  role: IntercompanyPostingRole;
}> {
  if (lines.length !== metadata.length) {
    throw new Error("Intercompany journal lines and metadata are misaligned");
  }
  const roles = new Map<string, IntercompanyPostingRole>();
  const register = (
    accountId: string | null | undefined,
    role: IntercompanyPostingRole,
  ) => {
    if (!accountId) return;
    const existing = roles.get(accountId);
    if (existing && existing !== role) {
      throw new Error(`Ambiguous intercompany account roles for ${accountId}`);
    }
    roles.set(accountId, role);
  };
  register(accounts.controlAccountId, "Control");
  for (const account of accounts.revenueAccountIds ?? []) {
    register(account, "Revenue");
  }
  register(accounts.cogsAccountId, "COGS");
  for (const account of accounts.capitalizationAccountIds ?? []) {
    register(account, "Capitalization");
  }
  return lines.flatMap((line, index) => {
    if (!line.id) {
      throw new Error(
        "Missing returned journal line ID for intercompany capture",
      );
    }
    const role = line.accountId ? roles.get(line.accountId) : undefined;
    if (!role || !line.accountId) return [];
    return [{
      journalLineId: line.id,
      accountId: line.accountId,
      amount: line.amount ?? 0,
      quantity: line.quantity ?? null,
      itemId: metadata[index]?.itemId ?? null,
      role,
    }];
  });
}
