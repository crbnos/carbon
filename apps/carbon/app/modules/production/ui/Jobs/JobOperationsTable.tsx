import { useCarbon } from "@carbon/auth";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuRefreshCcwDot } from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { EditableNumber } from "~/components/Editable";
import { Enumerable } from "~/components/Enumerable";
import { OperationStatusIcon } from "~/components/Icons";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { operationTypes } from "~/modules/shared";
import { path } from "~/utils/path";
import { jobOperationStatus } from "../../production.models";
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

  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();

  const onOperationStatusChange = useCallback(
    async (id: string, status: JobOperation["status"]) => {
      const formData = new FormData();
      formData.set("id", id);
      formData.set("status", status);

      return await fetcher.submit(formData, {
        method: "post",
        action: path.to.jobOperationStatus,
      });
    },
    [fetcher]
  );

  const columns = useMemo<ColumnDef<JobOperation>[]>(() => {
    return [
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <HStack className="py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label="Change status"
                  icon={
                    <OperationStatusIcon
                      status={isPaused ? "Paused" : row.original.status}
                    />
                  }
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={row.original.status}
                  onValueChange={(status) =>
                    onOperationStatusChange(
                      row.original.id,
                      status as JobOperation["status"]
                    )
                  }
                >
                  {jobOperationStatus.map((status) => (
                    <DropdownMenuRadioItem key={status} value={status}>
                      <DropdownMenuIcon
                        icon={<OperationStatusIcon status={status} />}
                      />
                      <span>{status}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Hyperlink
              to={`${path.to.jobProductionEvents(
                jobId
              )}?filter=jobOperationId:eq:${row.original.id}`}
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
          return row.original.jobMakeMethod?.item?.readableId;
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
      {
        accessorKey: "quantityReworked",
        header: "Qty. Reworked",
        cell: (item) => item.getValue(),
      },
    ];
  }, [isPaused, jobId, onOperationStatusChange]);

  const { carbon } = useCarbon();
  const { id: userId } = useUser();
  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: JobOperation) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("jobOperation")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [carbon, userId]
  );

  const editableComponents = useMemo(() => {
    return {
      operationQuantity: EditableNumber(onCellEdit),
      quantityScrapped: EditableNumber(onCellEdit),
      quantityComplete: EditableNumber(onCellEdit),
      quantityReworked: EditableNumber(onCellEdit),
    };
  }, [onCellEdit]);

  return (
    <Table<JobOperation>
      count={count}
      columns={columns}
      data={data}
      primaryAction={
        data.length > 0 && permissions.can("update", "production") ? (
          <fetcher.Form action={path.to.jobRecalculate(jobId)} method="post">
            <Button
              leftIcon={<LuRefreshCcwDot />}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="secondary"
            >
              Recalculate
            </Button>
          </fetcher.Form>
        ) : undefined
      }
      editableComponents={editableComponents}
      withInlineEditing={permissions.can("update", "production")}
    />
  );
});

JobOperationsTable.displayName = "JobOperationsTable";

export default JobOperationsTable;
