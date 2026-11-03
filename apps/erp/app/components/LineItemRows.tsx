// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack } from "@carbon/react";
import { type ReactNode, useMemo } from "react";
import { useQuantityFormatter, useUrlParams } from "~/hooks";
import {
  matchingSearchLines,
  type SearchLine,
  searchLinesOf,
  searchMatches,
  searchTerms
} from "~/utils/search";
import { Highlight } from "./Highlight";

/**
 * The expanded row of a document list: the lines the search matched, each
 * match marked, or every line when no line matched (a row opened by hand).
 */
function LineItems({ row, terms }: { row: object; terms: string[] }) {
  const formatQuantity = useQuantityFormatter();
  const quantityOf = (quantity: SearchLine["quantity"]) => {
    if (quantity === null) return "";
    if (Array.isArray(quantity)) {
      return quantity.map((value) => formatQuantity(value)).join(" / ");
    }
    return formatQuantity(quantity);
  };

  const matching = matchingSearchLines(row, terms);
  const lines = matching.length > 0 ? matching : searchLinesOf(row);

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
 * The `Table` props of a document list with line items (`searchLines`): every
 * row with lines can be opened to show them, and all rows start collapsed.
 * While the URL search has a word, the rows with a matching line open to
 * those lines.
 */
export function useLineItemRows<T extends object>(): {
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
      renderExpandedRow: (row: T) => <LineItems row={row} terms={terms} />,
      canExpandRow: (row: T) => searchLinesOf(row).length > 0,
      expandRowsFor: terms.length > 0 ? search : null,
      expandRowByDefault: (row: T) =>
        matchingSearchLines(row, terms).length > 0,
      pinExpandedRows: true
    };
  }, [search]);
}
