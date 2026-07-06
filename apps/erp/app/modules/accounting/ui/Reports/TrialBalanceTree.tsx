import { cn, ScrollArea } from "@carbon/react";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuFolder,
  LuFolderOpen
} from "react-icons/lu";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useRealtime } from "~/hooks";
import type { Chart } from "../../types";

type TrialBalanceChart = Chart & {
  translatedBalance?: number;
  exchangeRate?: number;
};

type TrialBalanceTreeProps = {
  data: TrialBalanceChart[];
  showTranslated?: boolean;
  parentCurrency?: string | null;
  search: string;
};

function accountsToFlatTree(
  accounts: TrialBalanceChart[]
): FlatTree<TrialBalanceChart> {
  const byParent = new Map<string, TrialBalanceChart[]>();
  for (const a of accounts) {
    const key = a.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const result: FlatTreeItem<TrialBalanceChart>[] = [];

  function walk(parentId: string | null, level: number) {
    const children = (byParent.get(parentId ?? "__root__") ?? []).sort(
      (a, b) => {
        const aIsGroup = a.isGroup ? 1 : 0;
        const bIsGroup = b.isGroup ? 1 : 0;
        if (aIsGroup !== bIsGroup) return aIsGroup - bIsGroup;
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

function filterAccounts(
  accounts: TrialBalanceChart[],
  search: string
): TrialBalanceChart[] {
  if (!search.trim()) return accounts;
  const lower = search.toLowerCase();

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const matched = new Set<string>();

  for (const a of accounts) {
    const nameMatch = a.name?.toLowerCase().includes(lower);
    const numberMatch = a.number?.toLowerCase().includes(lower);
    if (nameMatch || numberMatch) {
      matched.add(a.id as string);
      let parentId = a.parentId;
      while (parentId) {
        matched.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent?.parentId ?? null;
      }
    }
  }

  return accounts.filter((a) => matched.has(a.id as string));
}

function formatCurrency(value: number): string {
  if (value === 0) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

/** Normal-debit accounts: positive balance = debit */
function isNormalDebit(accountClass: string | null | undefined): boolean {
  return accountClass === "Asset" || accountClass === "Expense";
}

/**
 * Split net change into debit and credit based on account class.
 * Normal-debit accounts (Asset, Expense): positive netChange = debit
 * Normal-credit accounts (Liability, Equity, Revenue): positive netChange = credit
 */
function getDebitCredit(
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

const TrialBalanceTree = memo(
  ({
    data,
    showTranslated = false,
    parentCurrency,
    search
  }: TrialBalanceTreeProps) => {
    useRealtime("journal");
    const parentRef = useRef<HTMLDivElement>(null);

    const filtered = useMemo(
      () => filterAccounts(data, search),
      [data, search]
    );
    const tree = useMemo(() => accountsToFlatTree(filtered), [filtered]);

    // Build a lookup of balanceAtDate by account id for ratio calculation
    const balanceById = useMemo(() => {
      const map = new Map<string, number>();
      for (const account of data) {
        map.set(account.id, account.balanceAtDate ?? 0);
      }
      return map;
    }, [data]);

    const {
      nodes,
      getTreeProps,
      getNodeProps,
      selectNode,
      toggleExpandNode,
      virtualizer
    } = useTree<TrialBalanceChart, undefined>({
      tree,
      parentRef,
      estimatedRowHeight: () => 36,
      isEager: true
    });

    return (
      <ScrollArea className="h-[calc(100dvh-var(--header-height)-61px)] w-full">
        <div className="sticky top-0 z-10 flex h-11 items-center pr-4 text-sm font-medium text-foreground/80 border-b border-border bg-card">
          <div className="flex-1 px-4">Account</div>
          <span className="w-28 text-right px-4">Beginning</span>
          <span className="w-28 text-right px-4">Debits</span>
          <span className="w-28 text-right px-4">Credits</span>
          <span className="w-28 text-right px-4">Ending</span>
          {showTranslated && (
            <span className="w-28 text-right px-4">
              Ending ({parentCurrency ?? "Translated"})
            </span>
          )}
          <span className="w-16 text-right px-4">Ratio</span>
        </div>
        <TreeView<TrialBalanceChart>
          tree={tree}
          nodes={nodes}
          getTreeProps={getTreeProps}
          getNodeProps={getNodeProps}
          virtualizer={virtualizer}
          parentRef={parentRef}
          parentClassName="h-full"
          renderNode={({ node, state }) => {
            const account = node.data;
            const isGroup = account.isGroup;
            const isExpanded = state.expanded;

            const endingBalance = account.balanceAtDate ?? 0;
            const netChange = account.netChange ?? 0;
            const beginningBalance = endingBalance - netChange;
            const { debit, credit } = getDebitCredit(netChange, account.class);

            // Ratio: percentage of parent's ending balance
            const parentBalance = node.parentId
              ? (balanceById.get(node.parentId) ?? 0)
              : 0;
            const ratio =
              parentBalance !== 0
                ? (Math.abs(endingBalance) / Math.abs(parentBalance)) * 100
                : 0;

            return (
              <div
                className={cn(
                  "flex h-8 cursor-pointer items-center overflow-hidden pr-4 text-sm group/row",
                  state.selected
                    ? "bg-muted hover:bg-accent"
                    : "bg-transparent hover:bg-accent",
                  isGroup && "font-semibold"
                )}
                onClick={() => {
                  selectNode(node.id, false);
                  if (isGroup) {
                    toggleExpandNode(node.id);
                  }
                }}
              >
                {/* Indentation lines */}
                <div className="flex h-9 items-center">
                  {Array.from({ length: node.level }).map((_, index) => (
                    <LevelLine key={index} isSelected={state.selected} />
                  ))}

                  <div
                    className={cn(
                      "flex h-9 w-5 items-center justify-center",
                      node.hasChildren && "hover:bg-accent"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpandNode(node.id);
                    }}
                  >
                    {node.hasChildren ? (
                      isExpanded ? (
                        <LuChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <LuChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )
                    ) : (
                      <div className="h-9 w-5" />
                    )}
                  </div>
                </div>

                {/* Folder icon */}
                <div className="w-5 h-5 flex items-center justify-center mr-2 shrink-0">
                  {isGroup &&
                    (isExpanded ? (
                      <LuFolderOpen className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <LuFolder className="h-4 w-4 text-muted-foreground" />
                    ))}
                </div>

                {/* Account number + name */}
                <div className="flex flex-1 items-center gap-2 overflow-hidden">
                  {!isGroup && account.number && (
                    <span className="text-muted-foreground shrink-0">
                      {account.number}
                    </span>
                  )}
                  <span className="truncate">{account.name}</span>
                </div>

                {/* Beginning Balance */}
                <span className="w-28 text-right tabular-nums shrink-0 text-muted-foreground">
                  {formatCurrency(beginningBalance)}
                </span>

                {/* Debits */}
                <span className="w-28 text-right tabular-nums shrink-0 text-muted-foreground">
                  {formatCurrency(debit)}
                </span>

                {/* Credits */}
                <span className="w-28 text-right tabular-nums shrink-0 text-muted-foreground">
                  {formatCurrency(credit)}
                </span>

                {/* Ending Balance */}
                <span className="w-28 text-right tabular-nums shrink-0 text-muted-foreground">
                  {formatCurrency(endingBalance)}
                </span>

                {/* Translated Ending Balance */}
                {showTranslated && (
                  <span className="w-28 text-right tabular-nums shrink-0 text-muted-foreground">
                    {account.translatedBalance != null
                      ? formatCurrency(account.translatedBalance)
                      : "-"}
                  </span>
                )}

                {/* Ratio */}
                <span className="w-16 text-right tabular-nums shrink-0 text-muted-foreground">
                  {node.parentId ? formatPercent(ratio) : ""}
                </span>
              </div>
            );
          }}
        />
      </ScrollArea>
    );
  }
);

TrialBalanceTree.displayName = "TrialBalanceTree";
export default TrialBalanceTree;
