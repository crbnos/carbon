// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn } from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import type { TableJobRefusal } from "~/utils/table-jobs";
import { BROWSER_ROW_LIMIT } from "../infiniteRowsStore";
import type { AllMatchingSelection, InfiniteRows } from "../types";

/**
 * What the bar offers when every loaded row is selected and more rows exist:
 * "all" selects every matching row; "first" (a list past 1,000 rows without
 * a background path) selects the first 1,000.
 */
export type SelectAllOffer = "all" | "first";

type SelectAllMatchingBarProps = {
  /** The selected rows the browser holds. */
  selectedCount: number;
  /** The list's header count: exact below 1,000, else an estimate. */
  count: number;
  /** False while `count` is an estimate (`useExactCount`). */
  countIsExact: boolean;
  allMatching: AllMatchingSelection | null;
  offer: SelectAllOffer | null;
  isLoading: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  className?: string;
};

/**
 * The bar above the rows: "100 selected · Select all 245 matching rows", and
 * "All matching rows selected (about 2,300) · Clear selection" after it.
 */
export function SelectAllMatchingBar({
  selectedCount,
  count,
  countIsExact,
  allMatching,
  offer,
  isLoading,
  onSelectAll,
  onClear,
  className
}: SelectAllMatchingBarProps) {
  const numberFormatter = useNumberFormatter();
  if (!allMatching && !offer) return null;
  const limit = numberFormatter.format(BROWSER_ROW_LIMIT);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground tabular-nums",
        className
      )}
    >
      {allMatching ? (
        <>
          <span>
            {countIsExact ? (
              <Plural
                value={count}
                one="All # matching row selected"
                other="All # matching rows selected"
              />
            ) : (
              <Plural
                value={allMatching.count}
                one="All matching rows selected (about #)"
                other="All matching rows selected (about #)"
              />
            )}
          </span>
          <span aria-hidden>·</span>
          <Button variant="link" size="sm" onClick={onClear}>
            <Trans>Clear selection</Trans>
          </Button>
        </>
      ) : (
        <>
          <span>
            <Plural value={selectedCount} one="# selected" other="# selected" />
          </span>
          <span aria-hidden>·</span>
          <Button
            variant="link"
            size="sm"
            isLoading={isLoading}
            onClick={onSelectAll}
          >
            {offer === "first" ? (
              <Trans>Select the first {limit} rows</Trans>
            ) : countIsExact ? (
              <Plural
                value={count}
                one="Select all # matching row"
                other="Select all # matching rows"
              />
            ) : (
              <Plural
                value={count}
                one="Select all matching rows (about #)"
                other="Select all matching rows (about #)"
              />
            )}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The tooltip of a bulk action that has no background path, shown disabled
 * while `allMatching` is set.
 */
export function useAllMatchingUnsupportedLabel() {
  const { t } = useLingui();
  const limit = useNumberFormatter().format(BROWSER_ROW_LIMIT);
  return t`Filter the list to ${limit} rows or fewer`;
}

/**
 * The toast a bulk action shows when its route started the background job
 * (`{ background: true }`): the selection is every matching row.
 */
export function useBackgroundBulkActionMessage() {
  const { t } = useLingui();
  return t`Running in the background. We'll notify you when it's done.`;
}

/**
 * Words why an export or a bulk action did not start, from the route's
 * `refusal` (`TableJobRefusal`, `~/utils/table-jobs`), or null when the
 * answer has none.
 */
export function useTableJobRefusalMessage() {
  const { t, i18n } = useLingui();
  return useCallback(
    (refusal: unknown): string | null => {
      if (!isTableJobRefusal(refusal)) return null;
      switch (refusal.code) {
        case "busy": {
          const minutes = i18n.number(refusal.minutes);
          if (refusal.kind === "export") {
            return refusal.minutes > 0
              ? t`An export is already running for your company. Try again when it ends, at the latest in ${minutes} min.`
              : t`An export is already running for your company. Try again when it ends.`;
          }
          return refusal.minutes > 0
            ? t`A bulk action is already running for your company. Try again when it ends, at the latest in ${minutes} min.`
            : t`A bulk action is already running for your company. Try again when it ends.`;
        }
        case "full":
          return t`Too many exports and bulk actions are running right now. Try again in a few minutes.`;
        case "row-limit": {
          const rows = i18n.number(refusal.maxRows);
          return t`This action runs on at most ${rows} rows. Filter the list to ${rows} rows or fewer.`;
        }
        case "not-supported":
          return t`This action cannot run on this list.`;
        case "no-permission":
          return t`You do not have permission to do this on every matching row.`;
        case "not-started":
          return t`It could not start. Try again.`;
      }
    },
    [t, i18n]
  );
}

function isTableJobRefusal(value: unknown): value is TableJobRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/** What a bulk action posts in place of ids for an "all matching" selection:
 *  the list and its URL search (the route reads it with `parseAllMatching`). */
export function allMatchingRequest(allMatching: AllMatchingSelection) {
  return { listKey: allMatching.listKey, search: allMatching.search };
}

// A selection belongs to one list: a new `resetKey` reads as no selection.
type KeyedSelection = { resetKey: string; selection: RowSelectionState };

/**
 * The Table's row selection, with "Select all matching" (see
 * `SelectAllMatchingBar`). While every matching row is selected, the
 * selection is derived: every loaded row, the rows loaded later included.
 * Any other change of the selection ends it.
 *
 * `rowSelection` / `onRowSelectionChange` are the Table's controlled props;
 * without them the hook keeps the selection, per list (`resetKey`).
 */
export function useSelectAllMatching<T>({
  rows,
  getRowId,
  isSelectable,
  hasStableRowIds,
  rowSelection: controlledSelection,
  onRowSelectionChange: onControlledChange,
  infiniteRows,
  count,
  canSelectAll
}: {
  rows: T[];
  getRowId: (row: T, index: number) => string;
  isSelectable: boolean;
  /** False when rows are keyed by index: a change of the row count clears the selection. */
  hasStableRowIds: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  infiniteRows: InfiniteRows<T>;
  /** The list's header count: exact below 1,000, else an estimate. */
  count: number;
  /** The list is infinite and has bulk actions. */
  canSelectAll: boolean;
}) {
  const { search } = useLocation();
  const { resetKey, hasMore, loadAll } = infiniteRows;
  const listKey = infiniteRows.options?.listKey;

  const [internal, setInternal] = useState<KeyedSelection>({
    resetKey,
    selection: {}
  });
  const isControlled = controlledSelection !== undefined;
  const ownSelection = internal.resetKey === resetKey ? internal.selection : {};
  const baseSelection = isControlled ? controlledSelection : ownSelection;
  const setBaseSelection: OnChangeFn<RowSelectionState> =
    onControlledChange ??
    ((updater) =>
      setInternal((previous) => {
        const current =
          previous.resetKey === resetKey ? previous.selection : {};
        return {
          resetKey,
          selection: typeof updater === "function" ? updater(current) : updater
        };
      }));

  // "All matching", with the selection it was chosen over: a new selection
  // or a new list ends it.
  const [chosen, setChosen] = useState<{
    allMatching: AllMatchingSelection;
    resetKey: string;
    over: RowSelectionState;
  } | null>(null);
  const allMatching =
    chosen && chosen.resetKey === resetKey && chosen.over === baseSelection
      ? chosen.allMatching
      : null;

  const everyRowSelection = useMemo(() => {
    if (!allMatching) return null;
    const selection: RowSelectionState = {};
    rows.forEach((row, index) => {
      selection[getRowId(row, index)] = true;
    });
    return selection;
  }, [allMatching, rows, getRowId]);
  const rowSelection = everyRowSelection ?? baseSelection;

  // A change made while every matching row is selected starts from that
  // selection, and becomes the new base selection.
  const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) =>
    setBaseSelection(
      everyRowSelection && typeof updater === "function"
        ? updater(everyRowSelection)
        : updater
    );

  /* Rows keyed by index: a new row count leaves the keys on other rows. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the row count changes
  useEffect(() => {
    if (isSelectable && !hasStableRowIds && !isControlled) {
      setBaseSelection({});
    }
  }, [rows.length, isSelectable]);

  // Every loaded row is selected and more rows exist: offer the rest. A list
  // without a background path offers at most the first 1,000 rows.
  const offer: SelectAllOffer | null =
    canSelectAll &&
    hasMore &&
    !allMatching &&
    rows.length > 0 &&
    rows.every((row, index) => rowSelection[getRowId(row, index)])
      ? count <= BROWSER_ROW_LIMIT || listKey
        ? "all"
        : rows.length < BROWSER_ROW_LIMIT
          ? "first"
          : null
      : null;

  const [isLoading, setIsLoading] = useState(false);
  const onSelectAll = async () => {
    if (count > BROWSER_ROW_LIMIT && listKey) {
      setChosen({
        allMatching: { listKey, search, count },
        resetKey,
        over: baseSelection
      });
      return;
    }
    setIsLoading(true);
    const loaded = await loadAll(BROWSER_ROW_LIMIT);
    setIsLoading(false);
    // The list changed while it loaded: its rows are not the ones offered.
    if (loaded.resetKey !== resetKey) return;
    setBaseSelection((previous) => {
      const next = { ...previous };
      loaded.rows.slice(0, BROWSER_ROW_LIMIT).forEach((row, index) => {
        next[getRowId(row, index)] = true;
      });
      return next;
    });
  };

  return {
    rowSelection,
    onRowSelectionChange,
    allMatching,
    bar: {
      allMatching,
      offer,
      isLoading,
      onSelectAll,
      onClear: () => setBaseSelection({})
    }
  };
}
