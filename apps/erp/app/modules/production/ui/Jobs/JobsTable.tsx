// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  BarProgress,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today
} from "@internationalized/date";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuBookMarked,
  LuCalendar,
  LuCirclePlay,
  LuClock,
  LuHash,
  LuLayers,
  LuMapPin,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuTag,
  LuTrash,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  EmployeeAvatar,
  exportOnlyColumn,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import type { BulkActionScope, InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  useAllMatchingLimitLabel,
  useBulkFormAction,
  useBulkStartToast
} from "~/hooks/useBulkAction";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { action as releaseAction } from "~/routes/x+/job+/release";
import { useCustomers, useParts, usePeople, useTools } from "~/stores";
import {
  bulkSelectionBody,
  isOverAllMatchingLimit
} from "~/utils/bulk-selection";
import { path } from "~/utils/path";
import { ALL_MATCHING_RELEASE_LIMIT } from "~/utils/table-jobs";
import {
  deadlineTypes,
  isJobBulkReleasable,
  isJobDeletable,
  jobStatus
} from "../../production.models";
import type { Job } from "../../types";
import { getDeadlineIcon } from "./Deadline";
import JobStatus from "./JobStatus";
import { JOB_LIST_EXPORT_VALUES } from "./job-list-export";

// A row of the jobs list, with the values the loader adds per page.
type JobRow = Job & {
  // The readableIds of the live (Active/Completing) operation batches the job
  // has an operation in. Batching is per-operation, so this is the only
  // job-level view of it.
  batchReadableIds: string[];
  // The readableId of the tracked entity the job's make method produces.
  trackedEntityReadableId: string | null;
};

type JobsTableProps = {
  data: JobRow[];
  count: number;
  infinite: InfiniteOptions;
  tags: { name: string }[];
};

const defaultColumnVisibility = {
  batches: false,
  description: false,
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
  orderQuantity: false,
  inventoryQuantity: false,
  productionQuantity: false,
  scrapQuantity: false,
  quantityComplete: false,
  quantityShipped: false,
  quantityReceivedToInventory: false
};

// A function declaration on purpose: `plural()` nested in `t` inside a
// `memo(…)` component compiles to the global i18n, which is never activated
// (see .claude/rules/i18n-lingui-system.md).
function useReleasedJobsMessage() {
  const { t } = useLingui();
  return (count: number) =>
    t`${plural(count, { one: "Released # job", other: "Released # jobs" })}`;
}

function renderQuantity(job: Job, unit?: string | null) {
  const quantity = job.quantity;
  const quantityComplete = job.quantityComplete ?? 0;

  if (["In Progress", "Released", "Paused"].includes(job.status ?? "")) {
    return (
      <BarProgress
        progress={(quantityComplete / (quantity ?? 0)) * 100}
        value={`${quantityComplete}/${quantity}`}
      />
    );
  }
  if (unit) {
    return (
      <>
        {quantity}
        <span className="ml-1 text-[13px] text-muted-foreground">{unit}</span>
      </>
    );
  }
  return quantity;
}

const JobsTable = memo((props: JobsTableProps) => {
  const { data, count, infinite, tags } = props;
  const navigate = useNavigate();
  const { t } = useLingui();
  const releasedJobsMessage = useReleasedJobsMessage();
  const [params] = useUrlParams();
  const parts = useParts();
  const tools = useTools();
  const items = useMemo(() => [...parts, ...tools], [parts, tools]);

  const [people] = usePeople();
  const [customers] = useCustomers();
  const locations = useLocations();

  // Scheduling dates belong to the job's location calendar. Empty timezone
  // means the location inherits the company's — omit it and the popover
  // collapses to the company row.
  const locationZoneProps = useCallback(
    (locationId: string | null | undefined) => {
      const timezone = locationId
        ? locations.find((l) => l.value === locationId)?.timezone
        : undefined;
      return timezone ? { locationTimeZone: timezone } : {};
    },
    [locations]
  );

  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const onDelete = (data: Job) => {
    setSelectedJob(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedJob(null);
    deleteModal.onClose();
  };

  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

  const customColumns = useCustomColumns<JobRow>("job");
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const columns = useMemo<ColumnDef<JobRow>[]>(() => {
    const defaultColumns: ColumnDef<JobRow>[] = [
      {
        accessorKey: "jobId",
        header: t`Job ID`,
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-expect-error
              type={row.original.itemType}
            />
            <Hyperlink to={path.to.job(row.original.id!)}>
              {row.original?.jobId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "itemReadableIdWithRevision",
        header: t`Item`,
        cell: ({ row }) => {
          return (
            <VStack spacing={0}>
              {row.original.itemReadableIdWithRevision}
              {distinctItemText(
                row.original.itemReadableIdWithRevision,
                row.original.name
              ) && (
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              )}
            </VStack>
          );
        },
        meta: {
          mobile: "P3",
          filter: {
            type: "static",
            options: items?.map((item) => ({
              value: item.readableIdWithRevision,
              label: item.readableIdWithRevision
            }))
          },
          icon: <AiOutlinePartition />
        }
      },
      exportOnlyColumn<JobRow>({
        id: "itemName",
        header: t`Item Name`,
        value: (row) => row.name ?? null
      }),
      {
        id: "trackedEntityId",
        header: t`Tracking`,
        cell: ({ row }) =>
          row.original.trackedEntityReadableId ? (
            <Badge variant="secondary" className="items-center gap-1">
              <LuQrCode />
              {row.original.trackedEntityReadableId}
            </Badge>
          ) : null,
        meta: {
          icon: <LuQrCode />,
          exportValue: JOB_LIST_EXPORT_VALUES.trackedEntityId
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => {
          const status = row.original.status;
          const dueDate = row.original.dueDate;
          return (
            <HStack spacing={1}>
              <JobStatus status={status} />
              {["Draft", "Planned", "In Progress", "Ready", "Paused"].includes(
                status ?? ""
              ) && (
                <>
                  {dueDate && isSameDay(parseDate(dueDate), todaysDate) && (
                    <JobStatus status="Due Today" />
                  )}
                  {dueDate && parseDate(dueDate) < todaysDate && (
                    <JobStatus status="Overdue" />
                  )}
                </>
              )}
            </HStack>
          );
        },
        meta: {
          mobile: "P2",
          filter: {
            type: "static",
            options: jobStatus.map((status) => ({
              value: status,
              label: <JobStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuUsers />
        }
      },
      {
        id: "batches",
        header: t`Batches`,
        cell: ({ row }) => {
          const batches = row.original.batchReadableIds ?? [];
          if (batches.length === 0) return null;
          return (
            <HStack spacing={1}>
              {batches.map((readableId) => (
                <Badge
                  key={readableId}
                  variant="secondary"
                  className="items-center gap-1"
                  title={t`An operation on this job runs in this batch`}
                >
                  <LuLayers />
                  {readableId}
                </Badge>
              ))}
            </HStack>
          );
        },
        meta: {
          icon: <LuLayers />,
          filterHeader: t`Batches`,
          exportValue: JOB_LIST_EXPORT_VALUES.batches
        }
      },
      {
        accessorKey: "quantity",
        header: t`Quantity`,
        cell: ({ row }) => renderQuantity(row.original),
        meta: {
          mobile: "P2",
          // Phones: no column header, so the number carries its unit.
          mobileCell: ({ row }) =>
            renderQuantity(row.original, row.original.unitOfMeasureCode),
          icon: <LuHash />,
          renderTotal: true
        }
      },

      {
        id: "customerId",
        header: t`Customer`,
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuSquareUser />
        }
      },
      {
        accessorKey: "salesOrderReadableId",
        header: t`Sales Order`,
        cell: ({ row }) =>
          row.original.salesOrderId && row.original.salesOrderLineId ? (
            <Hyperlink
              to={path.to.salesOrderLine(
                row.original.salesOrderId,
                row.original.salesOrderLineId!
              )}
            >
              {row.original?.salesOrderReadableId}
            </Hyperlink>
          ) : null,
        meta: {
          icon: <LuBookMarked />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.salesOrders,
            transform: (data: { id: string; salesOrderId: string }[] | null) =>
              data?.map(({ salesOrderId }) => ({
                value: salesOrderId,
                label: salesOrderId
              })) ?? []
          }
        }
      },

      {
        id: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "startDate",
        header: t`Start Date`,
        // Scheduling dates are operational — resolve on the job's location
        // calendar, not the company's.
        cell: ({ row }) => (
          <DateTime
            value={row.original.startDate}
            variant="date"
            {...locationZoneProps(row.original.locationId)}
          />
        ),
        meta: {
          filter: {
            type: "dateRange"
          },
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: ({ row }) => (
          <DateTime
            value={row.original.dueDate}
            variant="date"
            {...locationZoneProps(row.original.locationId)}
          />
        ),
        meta: {
          filter: {
            type: "dateRange"
          },
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "deadlineType",
        header: t`Deadline Type`,
        cell: ({ row }) => {
          const dueDate = row.original.dueDate!;
          const deadlineType = row.original.deadlineType!;

          if (!dueDate)
            return (
              <div className="flex gap-1 items-center">
                {getDeadlineIcon(deadlineType)}
                <span>{deadlineType}</span>
              </div>
            );

          return (
            <div className="flex items-center gap-1">
              {getDeadlineIcon(deadlineType)}
              <span>{deadlineType}</span>
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: deadlineTypes.map((type) => ({
              value: type,
              label: (
                <div className="flex gap-1 items-center">
                  {getDeadlineIcon(type)}
                  <span>{type}</span>
                </div>
              )
            }))
          },
          icon: <LuClock />
        }
      },
      {
        accessorKey: "tags",
        header: t`Tags`,
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "orderQuantity",
        header: t`Order Qty`,
        cell: (item) => item.getValue<number>(),
        // Not a column of the `jobs` view, so the server cannot sort by it.
        enableSorting: false,
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "inventoryQuantity",
        header: t`Inventory Qty`,
        cell: (item) => item.getValue<number>(),
        // Not a column of the `jobs` view, so the server cannot sort by it.
        enableSorting: false,
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "productionQuantity",
        header: t`Production Qty`,
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "scrapQuantity",
        header: t`Scrap Qty`,
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityComplete",
        header: t`Completed Qty`,
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityShipped",
        header: t`Shipped Qty`,
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "quantityReceivedToInventory",
        header: t`Received Qty`,
        cell: (item) => item.getValue<number>(),
        meta: {
          icon: <LuHash />,
          renderTotal: true
        }
      },
      {
        accessorKey: "locationId",
        header: t`Location`,
        cell: ({ row }) => (
          <Enumerable
            value={
              locations.find((l) => l.value === row.original.locationId)
                ?.label ?? null
            }
          />
        ),
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: locations.map((l) => ({
              value: l.value,
              label: <Enumerable value={l.label} />
            }))
          }
        }
      },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: t`Updated By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: t`Updated At`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [params, customColumns]);

  const { submit: submitBulk } = useBulkFormAction();
  const onBulkUpdate = useCallback(
    (
      selectedRows: typeof data,
      field: "delete",
      value?: string,
      scope?: BulkActionScope
    ) => {
      submitBulk(
        path.to.bulkUpdateJob,
        { scope, idsField: "ids", ids: selectedRows.map((row) => row.id) },
        { field, value }
      );
    },
    [submitBulk]
  );

  // Bulk release for the selected rows — Draft and Planned jobs only. Posts the
  // ids to the release action, which holds each job to the job page's release
  // checks and releases the ones that pass; we toast the summary.
  const showBulkStart = useBulkStartToast();
  const releaseLimitLabel = useAllMatchingLimitLabel(
    ALL_MATCHING_RELEASE_LIMIT
  );
  const releaseFetcher = useAction<typeof releaseAction>({
    onSuccess: (result) => {
      if (showBulkStart(result)) return;
      const { data } = result;
      if (!data) return;
      if (data.released.length) {
        toast.success(releasedJobsMessage(data.released.length));
      }
      if (data.warnings.length) {
        toast.error(
          t`Released with problems: ${data.warnings
            .map((w) => `${w.readableId} (${w.message})`)
            .join(", ")}`
        );
      }
      if (data.failed.length) {
        toast.error(
          t`Could not release ${data.failed.length}: ${data.failed
            .map((f) => `${f.readableId} (${f.message})`)
            .join(", ")}`
        );
      }
      if (!data.scheduled) {
        toast.error(t`The schedule could not be updated after the release`);
      }
    },
    onError: (result) => {
      if (showBulkStart(result)) return;
      if (result.error?.message) toast.error(result.error.message);
    }
  });

  const renderActions = useCallback(
    (selectedRows: typeof data, scope?: BulkActionScope) => {
      const releasable = selectedRows.filter((row) =>
        isJobBulkReleasable(row.status)
      );
      // Every matching row: the server picks the jobs each action may act on
      // and skips the rest. Release runs on at most 2,000 of them.
      const allMatching = scope?.allMatching;
      const overReleaseLimit = isOverAllMatchingLimit(
        scope,
        ALL_MATCHING_RELEASE_LIMIT
      );
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>
            <Trans>Update</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={
                !permissions.can("update", "production") ||
                (!allMatching && releasable.length === 0) ||
                overReleaseLimit ||
                releaseFetcher.isPending
              }
              onClick={() =>
                releaseFetcher.submit(
                  bulkSelectionBody({
                    scope,
                    idsField: "jobIds",
                    ids: releasable.map((row) => row.id)
                  }),
                  {
                    method: "post",
                    action: path.to.bulkReleaseJob,
                    encType: "application/json"
                  }
                )
              }
            >
              <MenuIcon icon={<LuCirclePlay />} />
              <div className="flex flex-col">
                <Trans>Release Jobs</Trans>
                {overReleaseLimit && (
                  <span className="text-xs text-muted-foreground">
                    {releaseLimitLabel}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                !permissions.can("delete", "production") ||
                (!allMatching &&
                  selectedRows.some((row) => !isJobDeletable(row.status)))
              }
              destructive
              onClick={() =>
                onBulkUpdate(selectedRows, "delete", undefined, scope)
              }
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Jobs
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    },
    [onBulkUpdate, permissions, releaseFetcher, releaseLimitLabel]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const renderContextMenu = useCallback<(row: JobRow) => JSX.Element>(
    (row) => (
      <>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          onClick={() => {
            navigate(path.to.job(row.id!));
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          Edit Job
        </MenuItem>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.delete}
          destructive
          disabled={
            !permissions.can("delete", "production") ||
            !isJobDeletable(row.status)
          }
          onClick={() => onDelete(row)}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Job
        </MenuItem>
      </>
    ),

    [navigate, params, permissions]
  );

  return (
    <>
      <Table<JobRow>
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={{
          left: ["jobId"]
        }}
        columns={columns}
        count={count ?? 0}
        infinite={infinite}
        primaryAction={
          permissions.can("update", "resources") && (
            <New label={t`Job`} to={path.to.newJob} />
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Jobs`}
        table="job"
        withSavedView
        withSelectableRows
      />

      {selectedJob && selectedJob.id && (
        <ConfirmDelete
          action={path.to.deleteJob(selectedJob.id)}
          name={selectedJob?.jobId ?? ""}
          text={`Are you sure you want to delete the job: ${selectedJob?.jobId}?`}
          isOpen={deleteModal.isOpen}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
});

JobsTable.displayName = "JobsTable";
export default JobsTable;
