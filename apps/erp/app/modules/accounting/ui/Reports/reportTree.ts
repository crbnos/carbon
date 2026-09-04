import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { NET_INCOME_ACCOUNT_ID } from "../../types";

// The minimal account shape the report trees need to build/filter a hierarchy.
export type ReportAccountNode = {
  id: string;
  parentId: string | null;
  name: string | null;
  number: string | null;
  isGroup: boolean | null;
};

// Shared by TrialBalanceTree and MultiPeriodStatementTree: build the flat tree
// in display order — groups sort before leaves, the computed Net Income line
// always sorts to the end of its group, everything else alphabetically.
export function accountsToFlatTree<T extends ReportAccountNode>(
  accounts: T[]
): FlatTree<T> {
  const byParent = new Map<string, T[]>();
  for (const a of accounts) {
    const key = a.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const result: FlatTreeItem<T>[] = [];

  function walk(parentId: string | null, level: number) {
    const children = (byParent.get(parentId ?? "__root__") ?? []).sort(
      (a, b) => {
        const aIsGroup = a.isGroup ? 1 : 0;
        const bIsGroup = b.isGroup ? 1 : 0;
        if (aIsGroup !== bIsGroup) return aIsGroup - bIsGroup;
        if (a.id === NET_INCOME_ACCOUNT_ID) return 1;
        if (b.id === NET_INCOME_ACCOUNT_ID) return -1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      }
    );
    for (const account of children) {
      const childAccounts = byParent.get(account.id) ?? [];
      const childIds = childAccounts.map((c) => c.id);
      result.push({
        id: account.id,
        parentId: parentId ?? undefined,
        children: childIds,
        hasChildren: childIds.length > 0,
        level,
        data: account
      });
      walk(account.id, level + 1);
    }
  }

  walk(null, 0);
  return result;
}

// Search filter: keep matched accounts plus all their ancestors so the tree
// path to a match stays visible.
export function filterAccounts<T extends ReportAccountNode>(
  accounts: T[],
  search: string
): T[] {
  if (!search.trim()) return accounts;
  const lower = search.toLowerCase();

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const matched = new Set<string>();

  for (const a of accounts) {
    const nameMatch = a.name?.toLowerCase().includes(lower);
    const numberMatch = a.number?.toLowerCase().includes(lower);
    if (nameMatch || numberMatch) {
      matched.add(a.id);
      let parentId = a.parentId;
      while (parentId) {
        matched.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent?.parentId ?? null;
      }
    }
  }

  return accounts.filter((a) => matched.has(a.id));
}

/** Normal-debit accounts: positive balance = debit */
export function isNormalDebit(
  accountClass: string | null | undefined
): boolean {
  return accountClass === "Asset" || accountClass === "Expense";
}

/**
 * Split net change into debit and credit based on account class.
 * Normal-debit accounts (Asset, Expense): positive netChange = debit
 * Normal-credit accounts (Liability, Equity, Revenue): positive netChange = credit
 */
export function getDebitCredit(
  netChange: number,
  accountClass: string | null | undefined
): { debit: number; credit: number } {
  if (netChange === 0) return { debit: 0, credit: 0 };

  if (isNormalDebit(accountClass)) {
    return netChange > 0
      ? { debit: netChange, credit: 0 }
      : { debit: 0, credit: Math.abs(netChange) };
  }
  // Normal credit accounts
  return netChange > 0
    ? { debit: 0, credit: netChange }
    : { debit: Math.abs(netChange), credit: 0 };
}
