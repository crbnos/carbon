import { cn } from "@carbon/react";
import type {
  ReportColumnGranularity,
  ReportPeriodBucket
} from "@carbon/utils";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  LuCalculator,
  LuChevronDown,
  LuChevronRight,
  LuFolder,
  LuFolderOpen
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useRealtime, useUrlParams } from "~/hooks";
import type { ChartPeriodSeries } from "../../types";
import { NET_INCOME_ACCOUNT_ID } from "../../types";
import { accountsToFlatTree, filterAccounts } from "./reportTree";

const ACCOUNT_COLUMN_WIDTH = 360;
const PERIOD_COLUMN_WIDTH = 128;

type MultiPeriodStatementTreeProps = {
  data: ChartPeriodSeries[];
  /** Ordered buckets from computeReportPeriodBuckets — one column each */
  periods: ReportPeriodBucket[];
  columns: ReportColumnGranularity;
  /**
   * Which measure the period cells show. The Balance Sheet reads
   * "balanceAtDate" (closing balance as of each bucket end); the Income
   * Statement reads "netChange" (activity within each bucket).
   */
  measure: "balanceAtDate" | "netChange";
  /** When true, cells show the bucket's translated balance instead */
  showTranslated?: boolean;
  parentCurrency?: string | null;
  search: string;
  /** When provided, clicking a leaf account opens its ledger drill-down */
  ledgerPath?: (accountId: string) => string;
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function getPeriodColumnLabel(
  bucket: ReportPeriodBucket,
  columns: ReportColumnGranularity,
  locale?: string
): string {
  switch (columns) {
    case "month":
      return formatDate(
        bucket.start,
        { month: "short", year: "numeric" },
        locale
      );
    case "quarter":
      return `Q${bucket.quarter} FY${bucket.fiscalYear}`;
    case "year":
      return `FY${bucket.fiscalYear}`;
  }
}

const MultiPeriodStatementTree = memo(
  ({
    data,
    periods,
    columns,
    measure,
    showTranslated = false,
    parentCurrency,
    search,
    ledgerPath
  }: MultiPeriodStatementTreeProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    useRealtime("journal");
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const parentRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLElement | null>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    // The tree's own element scrolls both axes; mirror its horizontal offset
    // onto the header viewport so the column headers track the columns.
    useEffect(() => {
      const element = scrollRef.current;
      if (!element) return;
      const sync = () => {
        if (headerRef.current) {
          headerRef.current.scrollLeft = element.scrollLeft;
        }
      };
      element.addEventListener("scroll", sync, { passive: true });
      return () => element.removeEventListener("scroll", sync);
    }, []);

    const openLedger = (accountId: string) => {
      if (!ledgerPath) return;
      const nextParams = new URLSearchParams(params);
      nextParams.delete("offset");
      const qs = nextParams.toString();
      navigate(qs ? `${ledgerPath(accountId)}?${qs}` : ledgerPath(accountId));
    };

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
    } = useTree<ChartPeriodSeries, undefined>({
      tree,
      parentRef,
      estimatedRowHeight: () => 36,
      isEager: true
    });

    const rowWidth =
      ACCOUNT_COLUMN_WIDTH + periods.length * PERIOD_COLUMN_WIDTH + 16;

    return (
      <div className="flex h-[calc(100dvh-var(--header-height)-61px)] w-full flex-col">
        {/* Header viewport — scrollLeft is mirrored from the tree below */}
        <div ref={headerRef} className="shrink-0 overflow-x-hidden">
          <div
            className="flex h-12 items-center border-b border-border bg-card pr-4 text-sm font-medium text-foreground/80"
            style={{ minWidth: rowWidth }}
          >
            <div
              className="sticky left-0 z-[2] flex h-full shrink-0 items-center bg-card px-4"
              style={{ width: ACCOUNT_COLUMN_WIDTH }}
            >
              <Trans>Account</Trans>
            </div>
            {periods.map((bucket) => (
              <div
                key={bucket.key}
                className="flex shrink-0 flex-col items-end justify-center px-2 text-right"
                style={{ width: PERIOD_COLUMN_WIDTH }}
              >
                <span className="whitespace-nowrap">
                  {getPeriodColumnLabel(bucket, columns, locale)}
                </span>
                {bucket.isPartial && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t`To Date`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <TreeView<ChartPeriodSeries>
          tree={tree}
          nodes={nodes}
          getTreeProps={getTreeProps}
          getNodeProps={getNodeProps}
          virtualizer={virtualizer}
          parentRef={parentRef}
          scrollRef={scrollRef}
          parentClassName="flex-1 overflow-x-auto"
          contentMinWidth={rowWidth}
          renderNode={({ node, state }) => {
            const account = node.data;
            const isGroup = account.isGroup;
            const isExpanded = state.expanded;
            const isDrillable =
              !isGroup && !!ledgerPath && account.id !== NET_INCOME_ACCOUNT_ID;

            return (
              <div
                className={cn(
                  "flex h-8 cursor-pointer items-center pr-4 text-sm group/row",
                  state.selected
                    ? "bg-muted hover:bg-accent"
                    : "bg-transparent hover:bg-accent",
                  isGroup && "font-semibold"
                )}
                style={{ minWidth: rowWidth }}
                onClick={() => {
                  selectNode(node.id, false);
                  if (isGroup) {
                    toggleExpandNode(node.id);
                  } else if (isDrillable) {
                    openLedger(account.id);
                  }
                }}
              >
                {/* Pinned account cell: indentation + folder + number + name */}
                <div
                  className={cn(
                    "sticky left-0 z-[1] flex h-full shrink-0 items-center overflow-hidden",
                    state.selected
                      ? "bg-muted group-hover/row:bg-accent"
                      : "bg-card group-hover/row:bg-accent"
                  )}
                  style={{ width: ACCOUNT_COLUMN_WIDTH }}
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
                  <div className="flex flex-1 items-center gap-2 overflow-hidden pr-2">
                    {!isGroup && account.number && (
                      <span className="text-muted-foreground shrink-0">
                        {account.number}
                      </span>
                    )}
                    <span className="truncate">{account.name}</span>
                    {account.id === NET_INCOME_ACCOUNT_ID && (
                      <LuCalculator className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </div>
                </div>

                {/* One cell per period bucket */}
                {periods.map((bucket) => {
                  const cell = account.periods?.[bucket.key];
                  // Translated: the Income Statement (netChange) must read the
                  // translated period delta; the Balance Sheet (balanceAtDate)
                  // reads the translated cumulative balance.
                  const value = showTranslated
                    ? measure === "netChange"
                      ? cell?.translatedNetChange
                      : cell?.translatedBalance
                    : (cell?.[measure] ?? 0);
                  return (
                    <span
                      key={bucket.key}
                      className={cn(
                        "shrink-0 px-2 text-right tabular-nums text-muted-foreground",
                        isDrillable &&
                          "group-hover/row:text-foreground group-hover/row:underline underline-offset-2 decoration-border"
                      )}
                      style={{ width: PERIOD_COLUMN_WIDTH }}
                    >
                      {formatCurrency(value)}
                    </span>
                  );
                })}
              </div>
            );
          }}
        />
        {showTranslated && parentCurrency && (
          <div className="shrink-0 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
            <Trans>Showing in {parentCurrency}</Trans>
          </div>
        )}
      </div>
    );
  }
);

MultiPeriodStatementTree.displayName = "MultiPeriodStatementTree";
export default MultiPeriodStatementTree;
