import { HStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { operationTypes } from "~/modules/shared";
import { path } from "~/utils/path";
import type { JobOperation } from "../../types";

type JobOperationsTableProps = {
  data: JobOperation[];
  count: number;
};

const JobOperationsTable = memo(({ data, count }: JobOperationsTableProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Job ID is required");

  const columns = useMemo<ColumnDef<JobOperation>[]>(() => {
    return [
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <HStack className="py-1">
            <Hyperlink
              to={path.to.jobMakeMethod(
                jobId,
                "make",
                row.original.jobMakeMethodId!
              )}
              className="max-w-[260px] truncate"
            >
              {row.original.description}
            </Hyperlink>
          </HStack>
        ),
      },
      {
        id: "item",
        header: "Item",
        cell: ({ row }) => {
          return (
            <Hyperlink
              to={
                row.original.jobMakeMethod?.parentMaterialId
                  ? path.to.jobMakeMethod(
                      jobId,
                      row.original.jobMakeMethodId!,
                      row.original.jobMakeMethod?.parentMaterialId
                    )
                  : path.to.jobMethod(jobId, row.original.jobMakeMethodId!)
              }
            >
              {row.original.jobMakeMethod?.item?.readableId}
            </Hyperlink>
          );
        },
      },
      {
        accessorKey: "operationType",
        header: "Operation Type",
        cell: (item) => <Enumerable value={item.getValue<string>() ?? null} />,
        meta: {
          filter: {
            type: "static",
            options: operationTypes.map((value) => ({
              value,
              label: <Enumerable value={value ?? null} />,
            })),
          },
        },
      },

      {
        accessorKey: "operationQuantity",
        header: "Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "quantityComplete",
        header: "Qty. Complete",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "quantityScrapped",
        header: "Qty. Scrapped",
        cell: (item) => item.getValue(),
      },
    ];
  }, [jobId]);

  return <Table<JobOperation> count={count} columns={columns} data={data} />;
});

JobOperationsTable.displayName = "JobOperationsTable";

export default JobOperationsTable;
