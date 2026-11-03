// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { HStack, Skeleton } from "@carbon/react";
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
  terms
}: {
  list: DocumentLineList;
  row: ListRow;
  terms: string[];
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
  return <LineList lines={lines} terms={terms} />;
}

function LineNote({ children }: { children: ReactNode }) {
  return (
    <div className="pl-[52px] pr-4 py-2 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function LineSkeleton() {
  return (
    <div className="pl-[52px] pr-4">
      {[0, 1].map((index) => (
        <div key={index} className="flex gap-3 py-2">
          <div aria-hidden className="w-5 shrink-0" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

function LineList({ lines, terms }: { lines: SearchLine[]; terms: string[] }) {
  const formatQuantity = useQuantityFormatter();
  const quantityOf = (quantity: SearchLine["quantity"]) => {
    if (quantity === null) return "";
    if (Array.isArray(quantity)) {
      return quantity.map((value) => formatQuantity(value)).join(" / ");
    }
    return formatQuantity(quantity);
  };

  return (
    <div className="pl-[52px] pr-4">
      {lines.map((line) => {
        const name = line.itemName ?? line.description;
        return (
          <div key={line.id} className="flex gap-3 py-2 text-sm">
            <div
              aria-hidden
              className="w-5 shrink-0 border-l border-border -my-2"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0">
              <HStack spacing={2} className="min-w-0">
                {line.itemReadableId && (
                  <span className="whitespace-nowrap font-medium">
                    <Highlight
                      text={line.itemReadableId}
                      ranges={searchMatches(line.itemReadableId, terms)}
                    />
                  </span>
                )}
                {[line.partNumber, line.orderNumber].map(
                  (value, index) =>
                    value && (
                      <span
                        key={index}
                        className="whitespace-nowrap text-xs text-muted-foreground"
                      >
                        <Highlight
                          text={value}
                          ranges={searchMatches(value, terms)}
                        />
                      </span>
                    )
                )}
              </HStack>
              <span className="truncate text-xs text-muted-foreground">
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
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {quantityOf(line.quantity)} {line.unitOfMeasureCode}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The `Table` props of a document list with line items: every row can be
 * opened to its lines, and all rows start collapsed. While the URL search has
 * a word, the rows with a matching line open to those lines.
 */
export function useLineItemRows<T extends ListRow>(
  list: DocumentLineList
): {
  renderExpandedRow: (row: T) => ReactNode;
  canExpandRow: (row: T) => boolean;
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
        <LineItems list={list} row={row} terms={terms} />
      ),
      // Without a search the lines are not read yet, so any row may have some.
      canExpandRow: (row: T) => (loadedSearchLines(row)?.length ?? 1) > 0,
      expandRowsFor: terms.length > 0 ? search : null,
      expandRowByDefault: (row: T) =>
        matchingSearchLines(row, terms).length > 0,
      pinExpandedRows: true
    };
  }, [list, search]);
}
