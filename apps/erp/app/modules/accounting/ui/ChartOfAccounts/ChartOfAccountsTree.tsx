import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ScrollArea
} from "@carbon/react";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuFilePlus,
  LuFolder,
  LuFolderOpen,
  LuFolderPlus,
  LuPencil,
  LuTrash2
} from "react-icons/lu";
import { useNavigate } from "react-router";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useRealtime, useSettings } from "~/hooks";
import type { Chart } from "../../types";

type ChartOfAccountsTreeProps = {
  data: Chart[];
  search: string;
};

function accountsToFlatTree(accounts: Chart[]): FlatTree<Chart> {
  const byParent = new Map<string, Chart[]>();
  for (const a of accounts) {
    const key = a.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const result: FlatTreeItem<Chart>[] = [];

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

function filterAccounts(accounts: Chart[], search: string): Chart[] {
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
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const ChartOfAccountsTree = memo(
  ({ data, search }: ChartOfAccountsTreeProps) => {
    useRealtime("journal");
    const settings = useSettings();
    const accountingEnabled = (settings as any).accountingEnabled ?? false;
    const parentRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const filtered = useMemo(
      () => filterAccounts(data, search),
      [data, search]
    );
    const tree = useMemo(() => accountsToFlatTree(filtered), [filtered]);

    const {
      nodes,
      getTreeProps,
      getNodeProps,
      selectNode,
      toggleExpandNode,
      virtualizer
    } = useTree<Chart, undefined>({
      tree,
      parentRef,
      estimatedRowHeight: () => 36,
      isEager: true
    });

    return (
      <ScrollArea className="h-[calc(100dvh-var(--header-height)-61px)] w-full">
        <div className="sticky top-0 z-10 flex h-11 items-center pr-4 text-sm font-medium text-foreground/80 border-b border-border bg-card">
          <div className="flex-1 px-4">Account</div>
          {accountingEnabled && (
            <span className="w-32 text-right px-4">Balance</span>
          )}
        </div>
        <TreeView<Chart>
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
                  } else {
                    navigate(account.id as string);
                  }
                }}
              >
                {/* Indentation lines */}
                <div className="flex h-9 items-center">
                  {Array.from({ length: node.level }).map((_, index) => (
                    <LevelLine key={index} isSelected={state.selected} />
                  ))}

                  {/* Expand/collapse chevron */}
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

                {/* Folder/dot icon */}
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

                {/* Balance */}
                {accountingEnabled && (
                  <span className="w-32 text-right tabular-nums shrink-0 text-muted-foreground">
                    {formatCurrency(account.balance ?? 0)}
                  </span>
                )}

                {/* Actions menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="ml-1 shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-accent group-hover/row:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LuEllipsisVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isGroup ? (
                      <>
                        {!account.isSystem && (
                          <DropdownMenuItem
                            onClick={() => navigate(account.id as string)}
                          >
                            <LuPencil className="mr-2 h-4 w-4" />
                            Edit Group
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(`new-group?parentId=${account.id}`)
                          }
                        >
                          <LuFolderPlus className="mr-2 h-4 w-4" />
                          Add Group
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => navigate(`new?parentId=${account.id}`)}
                        >
                          <LuFilePlus className="mr-2 h-4 w-4" />
                          Add Account
                        </DropdownMenuItem>
                        {!account.isSystem && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => navigate(`delete/${account.id}`)}
                          >
                            <LuTrash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onClick={() => navigate(account.id as string)}
                        >
                          <LuPencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => navigate(`delete/${account.id}`)}
                        >
                          <LuTrash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }}
        />
      </ScrollArea>
    );
  }
);

ChartOfAccountsTree.displayName = "ChartOfAccountsTree";
export default ChartOfAccountsTree;
