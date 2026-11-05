// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { prefetchLoaderQuery } from "@carbon/query/cache";
import { cn, Skeleton } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { type ReactNode, useMemo } from "react";
import { useQuantityFormatter, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import {
  type DocumentLineList,
  loadedSearchLines,
  matchingSearchLines,
  type SearchLine,
  searchMatches,
  searchTerms
} from "~/utils/search";
import { Highlight } from "./Highlight";

type ListRow = { id: string | null };

/**
 * The expanded row of a document list. A search reads each row's lines with
 * the list, and the row shows the lines that matched (every line when none
 * did). Without a search the lines load when the row is opened.
 */
function LineItems({
  list,
  row,
  terms,
  rowOrder
}: {
  list: DocumentLineList;
  row: ListRow;
  terms: string[];
  rowOrder: string | null;
}) {
  const withList = loadedSearchLines(row);
  const onOpen = useLoaderQuery<{ lines: SearchLine[] | null }>(
    withList || !row.id ? null : path.to.api.documentLines(list, row.id)
  );

  if (withList) {
    const matching = matchingSearchLines(row, terms);
    return (
      <LineList
        lines={matching.length > 0 ? matching : withList}
        terms={terms}
        rowOrder={rowOrder}
      />
    );
  }
  if (onOpen.isPending) return <LineSkeleton />;
  const lines = onOpen.data?.lines;
  if (!lines) {
    return (
      <LineNote>
        <Trans>The lines could not be loaded.</Trans>
      </LineNote>
    );
  }
  if (lines.length === 0) {
    return (
      <LineNote>
        <Trans>No lines</Trans>
      </LineNote>
    );
  }
  return <LineList lines={lines} terms={terms} rowOrder={rowOrder} />;
}

// One rule down the left ties the lines to their row. The text starts where
// the first data column's content does: the Table sets --expanded-row-indent
// to the width of its expand and select columns, its cells pad 16px, and this
// block pads 16px after a 1px rule. The phone list sets no indent.
const LINE_BLOCK =
  "@container mr-4 ml-[calc(var(--expanded-row-indent,17px)-1px)] border-l border-border";

// Wide, the lines share one grid so the columns line up: part, description,
// numbers, quantity. Narrow (a phone), each line wraps: part and numbers with
// the quantity, then the description.
const LINE_GRID =
  "py-1 @xl:grid @xl:grid-cols-[max-content_minmax(0,1fr)_max-content_max-content] @xl:gap-x-4";
const LINE_ROW =
  "grid grid-cols-[minmax(0,1fr)_max-content] items-baseline gap-x-4 py-1.5 pl-4 text-sm @xl:col-span-4 @xl:grid-cols-subgrid";

function LineNote({ children }: { children: ReactNode }) {
  return (
    <div className={LINE_BLOCK}>
      <div className="py-2 pl-4 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function LineSkeleton() {
  return (
    <div className={LINE_BLOCK}>
      <div className={LINE_GRID}>
        {[0, 1].map((index) => (
          <div key={index} className={cn(LINE_ROW, "items-center")}>
            <div className="@xl:contents">
              <Skeleton className="h-4 w-24 @xl:order-1" />
              <Skeleton className="hidden h-3 w-16 @xl:order-3 @xl:block" />
            </div>
            <Skeleton className="h-4 w-10 @xl:order-4" />
            <Skeleton className="col-span-2 mt-1 h-3 w-48 @xl:order-2 @xl:col-span-1 @xl:mt-0 @xl:h-4 @xl:w-64" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LineList({
  lines,
  terms,
  rowOrder
}: {
  lines: SearchLine[];
  terms: string[];
  /** The one order the row shows, so its lines need not repeat it. */
  rowOrder: string | null;
}) {
  const formatQuantity = useQuantityFormatter();
  const quantityOf = (quantity: SearchLine["quantity"]) => {
    if (quantity === null) return "";
    if (Array.isArray(quantity)) {
      return quantity.map((value) => formatQuantity(value)).join(" / ");
    }
    return formatQuantity(quantity);
  };
  const showOrder = (orderNumber: string | null | undefined) =>
    !!orderNumber &&
    (orderNumber !== rowOrder || searchMatches(orderNumber, terms).length > 0);

  return (
    <div className={LINE_BLOCK}>
      <div className={LINE_GRID}>
        {lines.map((line) => {
          const name = line.itemName ?? line.description;
          const numbers = [
            line.partNumber,
            showOrder(line.orderNumber) ? line.orderNumber : null
          ].filter((value): value is string => !!value);
          return (
            <div key={line.id} className={LINE_ROW}>
              <div className="flex min-w-0 items-baseline gap-2 @xl:contents">
                <span className="whitespace-nowrap font-medium tabular-nums @xl:order-1">
                  {line.itemReadableId && (
                    <Highlight
                      text={line.itemReadableId}
                      ranges={searchMatches(line.itemReadableId, terms)}
                    />
                  )}
                </span>
                <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums @xl:order-3">
                  {numbers.map((value, index) => (
                    <span key={index}>
                      {index > 0 && " · "}
                      <Highlight
                        text={value}
                        ranges={searchMatches(value, terms)}
                      />
                    </span>
                  ))}
                </span>
              </div>
              <span className="whitespace-nowrap text-right tabular-nums @xl:order-4">
                {quantityOf(line.quantity)}{" "}
                <span className="text-muted-foreground">
                  {line.unitOfMeasureCode}
                </span>
              </span>
              <span className="col-span-2 truncate text-xs text-muted-foreground @xl:order-2 @xl:col-span-1 @xl:text-sm">
                {name && (
                  <Highlight text={name} ranges={searchMatches(name, terms)} />
                )}
                {line.description && line.description !== name && (
                  <>
                    {" · "}
                    <Highlight
                      text={line.description}
                      ranges={searchMatches(line.description, terms)}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The `Table` props of a document list with line items: every row can be
 * opened to its lines, and all rows start collapsed. While the URL search has
 * a word, the rows with a matching line open to those lines.
 */
export function useLineItemRows<T extends ListRow>(
  list: DocumentLineList,
  /** The one order a row shows, if any (a module-level function: it is a
   *  memo dependency). Its lines then leave that order number out. */
  rowOrderOf?: (row: T) => string | null
): {
  renderExpandedRow: (row: T) => ReactNode;
  canExpandRow: (row: T) => boolean;
  prefetchExpandedRow: (row: T) => void;
  expandRowsFor: string | null;
  expandRowByDefault: (row: T) => boolean;
  pinExpandedRows: true;
} {
  const [params] = useUrlParams();
  const search = params.get("search");
  return useMemo(() => {
    const terms = searchTerms(search);
    return {
      renderExpandedRow: (row: T) => (
        <LineItems
          list={list}
          row={row}
          terms={terms}
          rowOrder={rowOrderOf?.(row) ?? null}
        />
      ),
      // Without a search the lines are not read yet, so any row may have some.
      canExpandRow: (row: T) => (loadedSearchLines(row)?.length ?? 1) > 0,
      // Fills the cache entry `LineItems` reads, so the open finds it loading.
      prefetchExpandedRow: (row: T) => {
        if (!row.id || loadedSearchLines(row)) return;
        prefetchLoaderQuery(path.to.api.documentLines(list, row.id));
      },
      expandRowsFor: terms.length > 0 ? search : null,
      expandRowByDefault: (row: T) =>
        matchingSearchLines(row, terms).length > 0,
      pinExpandedRows: true
    };
  }, [list, search, rowOrderOf]);
}
