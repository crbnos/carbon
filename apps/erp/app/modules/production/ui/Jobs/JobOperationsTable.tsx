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
  IconButton
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuCircleCheckBig,
  LuClipboardList,
  LuHash,
  LuPlay,
  LuRefreshCcwDot,
  LuRotateCcw,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import { useFetcher, useFetchers, useParams, useSubmit } from "react-router";
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
  const { t } = useLingui();
  if (!jobId) throw new Error("Job ID is required");

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const isPaused = routeData?.job?.status === "Paused";

  const fetcher = useFetcher<{}>();
  const submit = useSubmit();
  const permissions = usePermissions();

  const onOperationStatusChange = useCallback(
    (id: string, status: JobOperation["status"]) => {
      submit(
        {
          id,
          status
        },
        {
          method: "post",
          action: path.to.jobOperationStatus,
          navigate: false,
          fetcherKey: `jobOperation:${id}`
        }
      );
    },
    [submit]
  );

  const columns = useMemo<ColumnDef<JobOperation>[]>(() => {
    return [
      {
        accessorKey: "description",
        header: t`Description`,
        cell: ({ row }) => (
          <HStack className="py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={t`Change status`}
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
        meta: {
          icon: <LuClipboardList />
        }
      },
      {
        id: "mes",
        header: t`MES`,
        cell: ({ row }) => (
          <Button size="sm" variant="secondary" leftIcon={<LuPlay />} asChild>
            <a href={path.to.external.mesJobOperation(row.original.id)}>
              {t`Open`}
            </a>
          </Button>
        ),
        meta: {
          icon: <LuPlay />
        }
      },
      {
        id: "item",
        header: t`Item`,
        cell: ({ row }) => {
          return row.original.jobMakeMethod?.item?.readableIdWithRevision;
        },
        meta: {
          icon: <AiOutlinePartition />
        }
      },
      {
        accessorKey: "operationType",
        header: t`Operation Type`,
        cell: (item) => <Enumerable value={item.getValue<string>() ?? null} />,
        meta: {
          filter: {
            type: "static",
            options: operationTypes.map((value) => ({
              value,
              label: <Enumerable value={value ?? null} />
            }))
          },
          icon: <LuWrench />
        }
      },

      {
        accessorKey: "targetQuantity",
        header: t`Quantity`,
        cell: (item) =>
          item.getValue<number>() ?? item.row.original.operationQuantity ?? 0,
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "quantityComplete",
        header: t`Qty. Complete`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuCircleCheckBig />
        }
      },
      {
        accessorKey: "quantityScrapped",
        header: t`Qty. Scrapped`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuTriangleAlert />
        }
      },
      {
        accessorKey: "quantityReworked",
        header: t`Qty. Reworked`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuRotateCcw />
        }
      }
    ];
  }, [isPaused, jobId, onOperationStatusChange, t]);

  const { carbon } = useCarbon();
  const { id: userId } = useUser();
  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: JobOperation) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("jobOperation")
        .update({
          [id]: value,
          updatedBy: userId
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
      quantityReworked: EditableNumber(onCellEdit)
    };
  }, [onCellEdit]);

  const pendingItems = usePendingItems();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const optimisticData = useMemo<typeof data>(() => {
    if (pendingItems.length === 0) return data;
    return data.map((item) => {
      const pendingItem = pendingItems.find(
        (pendingItem) => pendingItem.id === item.id
      );
      if (pendingItem) {
        return {
          ...item,
          status: pendingItem.status
        };
      }
      return item;
    });
  }, [pendingItems.length]);

  return (
    <Table<JobOperation>
      compact
      count={count}
      columns={columns}
      data={optimisticData}
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
      title={t`Operations`}
      withInlineEditing={permissions.can("update", "production")}
    />
  );
});

JobOperationsTable.displayName = "JobOperationsTable";

export default JobOperationsTable;

const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.jobOperationStatus;
    })
    .reduce<{ id: string; status: JobOperation["status"] }[]>(
      (acc, fetcher) => {
        const id = fetcher.formData.get("id") as string;
        const status = fetcher.formData.get("status") as JobOperation["status"];

        if (id && status) {
          const newItem: { id: string; status: JobOperation["status"] } = {
            id,
            status
          };

          return [...acc, newItem];
        }
        return acc;
      },
      []
    );
};
