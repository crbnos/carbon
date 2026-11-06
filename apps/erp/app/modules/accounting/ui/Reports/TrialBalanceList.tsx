// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { DEFAULT_CURRENCY_DECIMALS, moneyFormatOptions } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import type { FlatTree } from "~/components/TreeView";
import {
  TreeView,
  treeRowFocusClassName,
  useRovingTreeFocus,
  useTree
} from "~/components/TreeView";
import { useRealtime, useUrlParams } from "~/hooks";
import {
  getTrialBalanceRows,
  getTrialBalanceTotals,
  hasYearEndClose,
  type TrialBalanceAccount,
  type TrialBalanceRow
} from "../../trial-balance";
import { reportFrameClassName, useReportColumnStep } from "./ColumnStepper";
import {
  treegridBodyProps,
  treegridNodeWrapperProps,
  treegridRowProps
} from "./treegrid";

type TrialBalanceListProps = {
  data: TrialBalanceAccount[];
  showTranslated?: boolean;
  parentCurrency?: string | null;
  search: string;
  /** When provided, clicking an account opens its ledger drill-down */
  ledgerPath?: (accountId: string) => string;
};

const cellClass = "w-32 text-right tabular-nums shrink-0 px-2";

const TrialBalanceList = memo(
  ({
    data,
    showTranslated = false,
    parentCurrency,
    search,
    ledgerPath
  }: TrialBalanceListProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    const formatter = useMemo(
      () =>
        new Intl.NumberFormat(
          locale,
          moneyFormatOptions(DEFAULT_CURRENCY_DECIMALS)
        ),
      [locale]
    );
    const format = (value: number | null) =>
      value == null || value === 0 ? "-" : formatter.format(value);

    // The close column only when the range crosses a fiscal year end.
    const showClose = useMemo(
      () => hasYearEndClose(getTrialBalanceRows(data, "")),
      [data]
    );
    const columnLabels = [
      t`Beginning`,
      t`Debits`,
      t`Credits`,
      ...(showClose ? [t`Year-End Close`] : []),
      t`Ending`,
      ...(showTranslated ? [t`Ending (${parentCurrency ?? "Translated"})`] : [])
    ];
    // Phones: one value column at a time, starting on Ending.
    const {
      isPhone,
      index: columnIndex,
      estimatedRowHeight,
      stepper
    } = useReportColumnStep({
      count: columnLabels.length,
      initial: showClose ? 4 : 3,
      label: (index) => columnLabels[index]
    });
    useRealtime("journal");
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const parentRef = useRef<HTMLDivElement>(null);

    const openLedger = (accountId: string) => {
      if (!ledgerPath) return;
      const qs = params.toString();
      navigate(qs ? `${ledgerPath(accountId)}?${qs}` : ledgerPath(accountId));
    };

    const rows = useMemo(
      () => getTrialBalanceRows(data, search),
      [data, search]
    );
    const totals = useMemo(() => getTrialBalanceTotals(rows), [rows]);
    const tree = useMemo<FlatTree<TrialBalanceRow>>(
      () =>
        rows.map((row) => ({
          id: row.id,
          parentId: undefined,
          children: [],
          hasChildren: false,
          level: 0,
          data: row
        })),
      [rows]
    );

    const { nodes, selected, getTreeProps, selectNode, virtualizer } = useTree<
      TrialBalanceRow,
      undefined
    >({
      tree,
      parentRef,
      estimatedRowHeight,
      isEager: true
    });
    const rovingFocus = useRovingTreeFocus({
      selected,
      selectNode,
      getTreeProps,
      parentRef,
      virtualizer
    });

    // Same order as the header; the translated cell only when shown.
    const valueCells = (
      values: Pick<
        TrialBalanceRow,
        | "beginning"
        | "debits"
        | "credits"
        | "close"
        | "ending"
        | "translatedEnding"
      >,
      endingClassName?: string
    ) => [
      <span key="beginning" role="gridcell" className={cellClass}>
        {format(values.beginning)}
      </span>,
      <span key="debits" role="gridcell" className={cellClass}>
        {format(values.debits)}
      </span>,
      <span key="credits" role="gridcell" className={cellClass}>
        {format(values.credits)}
      </span>,
      ...(showClose
        ? [
            <span key="close" role="gridcell" className={cellClass}>
              {format(values.close)}
            </span>
          ]
        : []),
      <span
        key="ending"
        role="gridcell"
        className={cn(cellClass, endingClassName)}
      >
        {format(values.ending)}
      </span>,
      ...(showTranslated
        ? [
            <span key="translated" role="gridcell" className={cellClass}>
              {format(values.translatedEnding)}
            </span>
          ]
        : [])
    ];

    const totalCells = valueCells(totals);

    return (
      <div
        role="treegrid"
        aria-label={t`Trial balance`}
        aria-rowcount={rows.length + 2}
        aria-colcount={(isPhone ? 1 : columnLabels.length) + 1}
        className={cn(reportFrameClassName, "flex flex-col")}
      >
        {isPhone && stepper}
        <div
          role="row"
          aria-rowindex={1}
          className={cn(
            "flex h-11 shrink-0 items-center pr-4 text-sm font-medium text-foreground/80 border-b border-border bg-card",
            // Phones: the stepper names the shown column; the header row stays for assistive tech.
            isPhone && "sr-only"
          )}
        >
          <div role="columnheader" className="flex-1 px-4">
            <Trans>Account</Trans>
          </div>
          {(isPhone ? [columnLabels[columnIndex]] : columnLabels).map(
            (label) => (
              <span key={label} role="columnheader" className={cellClass}>
                {label}
              </span>
            )
          )}
        </div>
        <TreeView<TrialBalanceRow>
          tree={tree}
          nodes={nodes}
          getTreeProps={treegridBodyProps(rovingFocus.getTreeProps)}
          getNodeProps={treegridNodeWrapperProps}
          virtualizer={virtualizer}
          parentRef={parentRef}
          parentClassName="min-h-0"
          renderNode={({ node, state, index }) => {
            const row = node.data;
            const cells = valueCells(
              row,
              ledgerPath &&
                "group-hover/row:text-foreground group-hover/row:underline underline-offset-2 decoration-border"
            );

            return (
              <div
                role="row"
                {...treegridRowProps({
                  level: node.level,
                  hasChildren: node.hasChildren,
                  expanded: state.expanded,
                  rowIndex: index + 2
                })}
                aria-selected={state.selected}
                {...rovingFocus.getRowProps(node.id)}
                className={cn(
                  "flex h-8 cursor-pointer items-center overflow-hidden pr-4 text-sm text-muted-foreground group/row max-md:h-11",
                  treeRowFocusClassName,
                  state.selected
                    ? "bg-muted hover:bg-accent"
                    : "bg-transparent hover:bg-accent"
                )}
                onClick={() => {
                  selectNode(node.id, false);
                  openLedger(row.id);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectNode(node.id, false);
                    openLedger(row.id);
                  }
                }}
              >
                <div
                  role="rowheader"
                  className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-4"
                >
                  {row.number && <span className="shrink-0">{row.number}</span>}
                  <span className="truncate text-foreground">{row.name}</span>
                </div>
                {isPhone ? cells[columnIndex] : cells}
              </div>
            );
          }}
        />
        <div
          role="row"
          aria-rowindex={rows.length + 2}
          className="flex h-10 shrink-0 items-center pr-4 text-sm font-semibold border-t border-border bg-card"
        >
          <div role="rowheader" className="flex-1 px-4">
            <Trans>Total</Trans>
          </div>
          {isPhone ? totalCells[columnIndex] : totalCells}
        </div>
      </div>
    );
  }
);

TrialBalanceList.displayName = "TrialBalanceList";
export default TrialBalanceList;
