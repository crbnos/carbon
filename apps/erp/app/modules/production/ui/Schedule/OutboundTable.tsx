// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Badge, Combobox, cn, HStack, VStack } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuMapPin,
  LuSquareUser,
  LuTruck
} from "react-icons/lu";
import type { z } from "zod";
import {
  CustomerAvatar,
  DateTime,
  exportOnlyColumn,
  Hyperlink,
  ItemThumbnail,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUrlParams } from "~/hooks";
import {
  JobOperationProgress,
  type jobOperationValidator
} from "~/modules/sales/ui/CustomerPortal";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";

export const outboundHorizons = ["7", "14", "30", "all"] as const;
export type OutboundHorizon = (typeof outboundHorizons)[number];

export function isOutboundHorizon(
  value: string | null
): value is OutboundHorizon {
  return outboundHorizons.includes(value as OutboundHorizon);
}

export type OutboundRow = {
  id: string;
  jobId: string | null;
  status: Database["public"]["Enums"]["jobStatus"] | null;
  itemReadableIdWithRevision: string | null;
  itemName: string | null;
  thumbnailPath: string | null;
  itemType: Database["public"]["Enums"]["itemType"] | null;
  customerId: string | null;
  customerName: string | null;
  salesOrderId: string | null;
  salesOrderReadableId: string | null;
  customerReference: string | null;
  /** The plant-calendar day the job completes — the grouping key. */
  completionDate: string | null;
  projectedCompletionAt: string | null;
  dueDate: string | null;
  promisedDate: string | null;
  productionQuantity: number | null;
  quantityComplete: number | null;
  shipToName: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToCountryCode: string | null;
  dropShipment: boolean;
  shippingMethod: string | null;
  operations: z.infer<typeof jobOperationValidator>;
};

const NO_DATE = "none";

/** "Austin, TX" — the part of an address a truck is routed by. */
function destination(row: OutboundRow) {
  return [row.shipToCity, row.shipToState].filter(Boolean).join(", ");
}

type OutboundTableProps = {
  rows: OutboundRow[];
  locationId: string;
  horizon: OutboundHorizon;
  /** The plant's IANA zone — completion days and times are on its clock. */
  timeZone: string;
  /** Today on the plant's calendar (YYYY-MM-DD). */
  today: string;
};

const OutboundTable = memo(
  ({ rows, locationId, horizon, timeZone, today }: OutboundTableProps) => {
    const { t } = useLingui();
    const [params, setParams] = useUrlParams();
    const locations = useLocations();

    const horizonOptions = useMemo(
      () => [
        { value: "7", label: t`Next 7 days` },
        { value: "14", label: t`Next 14 days` },
        { value: "30", label: t`Next 30 days` },
        { value: "all", label: t`All open jobs` }
      ],
      [t]
    );

    const groupRowsBy = useMemo(
      () => ({
        key: (row: OutboundRow) => row.completionDate ?? NO_DATE,
        header: (group: OutboundRow[]) => (
          <OutboundDayHeader
            date={group[0]?.completionDate ?? null}
            today={today}
          />
        )
      }),
      [today]
    );

    const columns = useMemo<ColumnDef<OutboundRow>[]>(
      () => [
        {
          accessorKey: "jobId",
          header: t`Job`,
          cell: ({ row }) => (
            <HStack>
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                type={(row.original.itemType as ItemType | null) ?? undefined}
              />
              <Hyperlink to={path.to.job(row.original.id)}>
                {row.original.jobId}
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          id: "shipTo",
          header: t`Ship To`,
          cell: ({ row }) => {
            const place = destination(row.original);
            if (!place && !row.original.shipToName) {
              return <span className="text-muted-foreground">—</span>;
            }
            return (
              <VStack spacing={0} className="min-w-0">
                <HStack spacing={1}>
                  <span className="font-medium truncate">
                    {place || row.original.shipToName}
                  </span>
                  {row.original.dropShipment && (
                    <Badge variant="outline" className="shrink-0">
                      <Trans>Drop Ship</Trans>
                    </Badge>
                  )}
                </HStack>
                {place && row.original.shipToName && (
                  <span className="text-xs text-muted-foreground truncate">
                    {row.original.shipToName}
                  </span>
                )}
              </VStack>
            );
          },
          meta: {
            icon: <LuMapPin />,
            filterHeader: t`Ship To`,
            exportValue: (row) => destination(row)
          }
        },
        {
          accessorKey: "shippingMethod",
          header: t`Ship Via`,
          cell: ({ row }) =>
            row.original.shippingMethod ? (
              <Enumerable value={row.original.shippingMethod} />
            ) : null,
          meta: {
            icon: <LuTruck />
          }
        },
        {
          accessorKey: "customerId",
          header: t`Customer`,
          cell: ({ row }) => (
            <CustomerAvatar customerId={row.original.customerId} />
          ),
          meta: {
            icon: <LuSquareUser />
          }
        },
        {
          accessorKey: "salesOrderReadableId",
          header: t`Sales Order`,
          cell: ({ row }) =>
            row.original.salesOrderId ? (
              <VStack spacing={0}>
                <Hyperlink to={path.to.salesOrder(row.original.salesOrderId)}>
                  {row.original.salesOrderReadableId}
                </Hyperlink>
                {row.original.customerReference && (
                  <span className="text-xs text-muted-foreground truncate">
                    {row.original.customerReference}
                  </span>
                )}
              </VStack>
            ) : null,
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "itemReadableIdWithRevision",
          header: t`Part`,
          cell: ({ row }) => (
            <VStack spacing={0} className="min-w-0">
              <span className="truncate">
                {row.original.itemReadableIdWithRevision}
              </span>
              {row.original.itemName && (
                <span className="text-xs text-muted-foreground truncate max-w-[240px]">
                  {row.original.itemName}
                </span>
              )}
            </VStack>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "promisedDate",
          header: t`Promised`,
          cell: ({ row }) => {
            const { promisedDate, completionDate } = row.original;
            // Late for the customer: the job completes after the date promised.
            const isLate =
              !!promisedDate &&
              !!completionDate &&
              completionDate > promisedDate;
            return (
              <span className={cn(isLate && "text-red-500")}>
                <DateTime
                  value={promisedDate}
                  variant="date"
                  locationTimeZone={timeZone}
                />
              </span>
            );
          },
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "progress",
          header: t`Progress`,
          // No attachments here, so the portal-only customerId is never read.
          cell: ({ row }) => (
            <JobOperationProgress
              customerId=""
              jobOperations={row.original.operations}
              jobOperationAttachments={{}}
            />
          ),
          meta: {
            filterHeader: t`Progress`,
            exportValue: (row) =>
              `${row.operations.filter((op) => op.status === "Done").length}/${row.operations.length}`
          }
        },
        {
          accessorKey: "dueDate",
          header: t`Due Date`,
          cell: ({ row }) => (
            <DateTime
              value={row.original.dueDate}
              variant="date"
              locationTimeZone={timeZone}
            />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        // The day each job is grouped under — the band above the rows, which
        // the CSV has no other way to carry.
        exportOnlyColumn<OutboundRow>({
          id: "completionDate",
          header: t`Completion Date`,
          value: (row) => row.completionDate
        })
      ],
      [t, timeZone]
    );

    return (
      <Table<OutboundRow>
        data={rows}
        columns={columns}
        count={rows.length}
        title={t`Outbound`}
        defaultColumnPinning={{ left: ["jobId"] }}
        defaultColumnVisibility={{ dueDate: false }}
        groupRowsBy={groupRowsBy}
        withPagination={false}
        withSimpleSorting={false}
        sort={null}
        // Location and range always narrow this report, so keep the toolbar
        // when nothing matches — it is how you pick another location.
        isFiltered
        emptyState={
          <p className="text-sm text-muted-foreground">
            {params.get("search") ? (
              <Trans>No jobs match your search.</Trans>
            ) : horizon === "all" ? (
              <Trans>No open jobs for sales orders at this location.</Trans>
            ) : (
              <Trans>
                No open jobs for sales orders are projected to complete at this
                location in the next {horizon} days.
              </Trans>
            )}
          </p>
        }
        headerActions={
          <HStack spacing={2}>
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                if (selected) setParams({ location: selected });
              }}
            />
            <Combobox
              asButton
              size="sm"
              value={horizon}
              options={horizonOptions}
              onChange={(selected) => {
                if (selected) setParams({ horizon: selected });
              }}
            />
          </HStack>
        }
      />
    );
  }
);

OutboundTable.displayName = "OutboundTable";

/** The band above each completion day: the date, and how near it is. */
function OutboundDayHeader({
  date,
  today
}: {
  date: string | null;
  today: string;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  const daysFromToday = date ? parseDate(date).compare(parseDate(today)) : null;

  const relative =
    daysFromToday === null
      ? null
      : daysFromToday < 0
        ? t`Overdue`
        : daysFromToday === 0
          ? t`Today`
          : daysFromToday === 1
            ? t`Tomorrow`
            : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span
        className={cn(
          "text-sm font-medium whitespace-nowrap",
          daysFromToday !== null && daysFromToday < 0 && "text-red-500"
        )}
      >
        {date
          ? formatDate(
              date,
              {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric"
              },
              locale
            )
          : t`No completion date`}
      </span>
      {relative && (
        <span className="text-xs text-muted-foreground">{relative}</span>
      )}
    </div>
  );
}

export { OutboundTable };
