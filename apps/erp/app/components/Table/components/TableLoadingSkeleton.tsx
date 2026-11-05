// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";

/** The Table's placeholder while its first rows load. */
export function TableLoadingSkeleton() {
  return (
    <div className="flex h-full w-full items-start justify-center">
      <TableBase full className="w-full">
        <Thead>
          <Tr>
            {Array.from({ length: 7 }).map((_, colIndex) => (
              <Th
                key={colIndex}
                className={cn(
                  "h-[44px] w-[200px] bg-card",
                  colIndex === 0 && "border-r border-border"
                )}
              >
                <div className="h-8" />
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {Array.from({ length: 30 }).map((_, rowIndex) => (
            <Tr key={rowIndex}>
              {Array.from({ length: 7 }).map((_, colIndex) => (
                <Td
                  key={colIndex}
                  className={cn(
                    "h-[44px] w-[200px]",
                    colIndex === 0 && "border-r border-border"
                  )}
                >
                  <div className="h-6 w-full bg-gradient-to-r from-foreground/10 to-foreground/10 rounded animate-pulse" />
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </TableBase>
    </div>
  );
}
