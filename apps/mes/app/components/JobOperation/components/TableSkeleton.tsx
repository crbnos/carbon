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
