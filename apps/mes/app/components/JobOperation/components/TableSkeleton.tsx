// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Skeleton, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";

export function TableSkeleton() {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {[...Array(5)].map((_, index) => (
          <Tr key={`skeleton-${index}`}>
            <Td>
              <Skeleton className="h-4 w-full" />
            </Td>
            <Td>
              <Skeleton className="h-4 w-full" />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
