import { HStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuCheckCircle, LuXCircle } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useRouteData } from "~/hooks";
import { operationTypes } from "~/modules/shared";
import { path } from "~/utils/path";
import type { Job, JobOperation } from "../../types";

type JobOperationsTableProps = {
  data: JobOperation[];
  count: number;
};

const JobOperationsTable = memo(({ data, count }: JobOperationsTableProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Job ID is required");

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const isPaused = routeData?.job?.status === "Paused";

  const columns = useMemo<ColumnDef<JobOperation>[]>(() => {
    return [
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <HStack className="py-1">
            {getStatusIcon(isPaused ? "Paused" : row.original.status)}
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
  }, [isPaused, jobId]);

  return <Table<JobOperation> count={count} columns={columns} data={data} />;
});

JobOperationsTable.displayName = "JobOperationsTable";

export default JobOperationsTable;

// TODO: this might be in a shared location since it is used in the MES too
export function getStatusIcon(status: JobOperation["status"]) {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className="text-foreground" />;
    case "Waiting":
    case "Canceled":
      return <LuXCircle className="text-muted-foreground" />;
    case "Done":
      return <LuCheckCircle className="text-blue-600" />;
    case "In Progress":
      return <AlmostDoneIcon />;
    case "Paused":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}
