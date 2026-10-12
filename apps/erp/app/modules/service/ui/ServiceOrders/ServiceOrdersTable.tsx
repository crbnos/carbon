// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendarClock,
  LuFileText,
  LuHardHat,
  LuMapPin,
  LuPackage,
  LuPencil,
  LuServer,
  LuSquareUser,
  LuStar,
  LuTag,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  EmployeeAvatar,
  EmployeeAvatarGroup,
  Empty,
  Enumerable,
  Hyperlink,
  New,
  Table
} from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ServiceOrderType } from "../../service.models";
import {
  listedServiceOrderTypes,
  serviceOrderStatuses
} from "../../service.models";
import type { ServiceOrderListItem } from "../../types";
import { ServiceOrderStatus } from "../ServiceStatus";

type ServiceOrdersTableProps = {
  data: ServiceOrderListItem[];
  count: number;
};

/** The planned start of the order's next visit that has not finished. */
export function nextVisitStart(order: ServiceOrderListItem): string | null {
  const starts = (order.visits ?? [])
    .filter(
      (visit) =>
        visit.plannedStart &&
        (visit.status === "Scheduled" ||
          visit.status === "Traveling" ||
          visit.status === "On Site")
    )
    .map((visit) => visit.plannedStart as string)
    .sort();
  return starts[0] ?? null;
}

/** The technicians of the order's visits, once each. */
function visitTechnicians(order: ServiceOrderListItem): string[] {
  return [
    ...new Set(
      (order.visits ?? [])
        .filter((visit) => visit.status !== "Cancelled")
        .map((visit) => visit.technicianId)
    )
  ];
}

const ServiceOrdersTable = memo(({ data, count }: ServiceOrdersTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const isFiltered = params.has("filter") || params.has("search");
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [customers] = useCustomers();
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<ServiceOrderListItem>[]>(() => {
    const typeLabels: Record<ServiceOrderType, string> = {
      "Field Visit": t`Field Visit`,
      "Depot Repair": t`Depot Repair`,
      Refurbishment: t`Refurbishment`
    };
    return [
      {
        accessorKey: "serviceOrderId",
        header: t`Service Order`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.serviceOrderDetails(row.original.id)}>
            <span className="whitespace-nowrap">
              {row.original.serviceOrderId}
            </span>
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ServiceOrderStatus status={row.original.status} />,
        meta: {
          filter: {
            type: "static",
            options: serviceOrderStatuses.map((status) => ({
              value: status,
              label: <ServiceOrderStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={typeLabels[row.original.type]} />,
        meta: {
          filter: {
            type: "static",
            options: listedServiceOrderTypes.map((type) => ({
              value: type,
              label: <Enumerable value={typeLabels[type]} />
            }))
          },
          pluralHeader: t`Types`,
          icon: <LuTag />,
          exportValue: (row: ServiceOrderListItem) => typeLabels[row.type]
        }
      },
      {
        accessorKey: "customerId",
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
          icon: <LuSquareUser />,
          exportValue: (row: ServiceOrderListItem) =>
            row.customer?.name ?? row.customerId
        }
      },
      {
        id: "serial",
        header: t`Serial`,
        enableSorting: false,
        accessorFn: (row) => row.trackedEntity?.readableId ?? "",
        cell: ({ row }) =>
          row.original.customerAssetId ? (
            <Hyperlink to={path.to.customerAsset(row.original.customerAssetId)}>
              <span className="whitespace-nowrap">
                {row.original.trackedEntity?.readableId}
              </span>
            </Hyperlink>
          ) : (
            <span className="whitespace-nowrap">
              {row.original.trackedEntity?.readableId}
            </span>
          ),
        meta: {
          icon: <LuServer />
        }
      },
      {
        accessorKey: "itemId",
        header: t`Item`,
        cell: ({ row }) => (
          <div className="flex flex-col min-w-0">
            <span className="truncate">
              {row.original.item?.readableIdWithRevision}
            </span>
            {row.original.item?.name && (
              <span className="text-xs text-muted-foreground truncate">
                {row.original.item.name}
              </span>
            )}
          </div>
        ),
        meta: {
          icon: <LuPackage />,
          exportValue: (row: ServiceOrderListItem) =>
            row.item?.readableIdWithRevision ?? row.itemId
        }
      },
      {
        id: "site",
        header: t`Site`,
        enableSorting: false,
        accessorFn: (row) => row.customerLocation?.name ?? "",
        cell: ({ row }) => row.original.customerLocation?.name ?? "—",
        meta: {
          icon: <LuMapPin />
        }
      },
      {
        id: "nextVisit",
        header: t`Next Visit`,
        enableSorting: false,
        accessorFn: (row) => nextVisitStart(row) ?? "",
        cell: ({ row }) => (
          <DateTime
            value={nextVisitStart(row.original)}
            variant="absolute"
            fallback="—"
          />
        ),
        meta: {
          icon: <LuCalendarClock />
        }
      },
      {
        id: "technicianId",
        header: t`Technicians`,
        enableSorting: false,
        accessorFn: (row) => visitTechnicians(row).join(","),
        cell: ({ row }) => {
          const technicians = visitTechnicians(row.original);
          return technicians.length > 0 ? (
            <EmployeeAvatarGroup employeeIds={technicians} />
          ) : (
            "—"
          );
        },
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuHardHat />,
          exportValue: (row: ServiceOrderListItem) =>
            visitTechnicians(row)
              .map(
                (id) =>
                  people.find((employee) => employee.id === id)?.name ?? id
              )
              .join(", ")
        }
      },
      {
        id: "coverageContract",
        header: t`Coverage Contract`,
        enableSorting: false,
        accessorFn: (row) => row.customerContract?.customerContractId ?? "",
        cell: ({ row }) =>
          row.original.customerContract ? (
            <Hyperlink to={path.to.contract(row.original.customerContract.id)}>
              <span className="whitespace-nowrap">
                {row.original.customerContract.customerContractId}
              </span>
            </Hyperlink>
          ) : (
            "—"
          ),
        meta: {
          icon: <LuFileText />
        }
      },
      {
        accessorKey: "assignee",
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
          icon: <LuUser />,
          exportValue: (row: ServiceOrderListItem) =>
            people.find((employee) => employee.id === row.assignee)?.name ??
            row.assignee
        }
      }
    ];
  }, [customers, people, t]);

  const renderContextMenu = useMemo(() => {
    return (row: ServiceOrderListItem) => (
      <MenuItem onClick={() => navigate(path.to.serviceOrderDetails(row.id))}>
        <MenuIcon icon={<LuPencil />} />
        <Trans>Open</Trans>
      </MenuItem>
    );
  }, [navigate]);

  return (
    <Table<ServiceOrderListItem>
      count={count}
      columns={columns}
      data={data}
      defaultColumnPinning={{
        left: ["serviceOrderId"]
      }}
      primaryAction={
        permissions.can("create", "service") && (
          <New label={t`Service Order`} to={path.to.newServiceOrder} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Service Orders`}
      emptyState={
        isFiltered ? undefined : (
          <Empty
            title={t`No service orders yet`}
            description={t`Field visits and refurbishments show here once opened.`}
          />
        )
      }
      table="serviceOrder"
      withSavedView
    />
  );
});
ServiceOrdersTable.displayName = "ServiceOrdersTable";

export default ServiceOrdersTable;
