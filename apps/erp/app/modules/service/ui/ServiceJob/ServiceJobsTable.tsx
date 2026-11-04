// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuChartNoAxesColumnIncreasing,
  LuMapPin,
  LuPencil,
  LuServer,
  LuShieldCheck,
  LuSquareUser,
  LuStar,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table
} from "~/components";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import MaintenancePriority from "~/modules/resources/ui/Maintenance/MaintenancePriority";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  serviceCoverages,
  serviceJobPriorities,
  serviceJobStatuses,
  serviceWorkSites
} from "../../service.models";
import type { ServiceJob } from "../../types";
import CoverageBadge, { useCoverageLabels } from "./CoverageBadge";
import ServiceJobStatus from "./ServiceJobStatus";
import { useWorkSiteLabels } from "./useServiceJobLabels";

type ServiceJobsTableProps = {
  data: ServiceJob[];
  count: number;
};

const ServiceJobsTable = memo(({ data, count }: ServiceJobsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const [customers] = useCustomers();
  const [people] = usePeople();
  const coverageLabels = useCoverageLabels();
  const workSiteLabels = useWorkSiteLabels();

  const columns = useMemo<ColumnDef<ServiceJob>[]>(() => {
    return [
      {
        accessorKey: "serviceJobId",
        header: t`Job`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.serviceJob(row.original.id)}>
            <span className="whitespace-nowrap">
              {row.original.serviceJobId}
            </span>
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ServiceJobStatus status={row.original.status} />,
        meta: {
          mobile: "P2",
          icon: <LuStar />,
          filter: {
            type: "static",
            options: serviceJobStatuses.map((status) => ({
              value: status,
              label: <ServiceJobStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`
        }
      },
      {
        accessorKey: "coverage",
        header: t`Coverage`,
        cell: ({ row }) => <CoverageBadge coverage={row.original.coverage} />,
        meta: {
          icon: <LuShieldCheck />,
          filter: {
            type: "static",
            options: serviceCoverages.map((coverage) => ({
              value: coverage,
              label: coverageLabels[coverage]
            }))
          },
          exportValue: (row: ServiceJob) => coverageLabels[row.coverage]
        }
      },
      {
        accessorKey: "customerId",
        header: t`Customer`,
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          mobile: "P3",
          icon: <LuSquareUser />,
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          exportValue: (row: ServiceJob) => row.customer?.name ?? row.customerId
        }
      },
      {
        id: "serial",
        header: t`Asset`,
        enableSorting: false,
        accessorFn: (row) => row.customerAsset?.trackedEntity?.readableId ?? "",
        cell: ({ row }) => {
          const asset = row.original.customerAsset;
          if (!asset) return null;
          return (
            <Hyperlink to={path.to.customerAsset(asset.id)}>
              <span className="whitespace-nowrap">
                {asset.trackedEntity?.readableId}
              </span>
            </Hyperlink>
          );
        },
        meta: {
          icon: <LuServer />
        }
      },
      {
        accessorKey: "workSite",
        header: t`Work Site`,
        cell: ({ row }) => workSiteLabels[row.original.workSite],
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static",
            options: serviceWorkSites.map((workSite) => ({
              value: workSite,
              label: workSiteLabels[workSite]
            }))
          }
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => {
          const assignee = row.original.assignee;
          if (!assignee) {
            return (
              <span className="text-muted-foreground">
                <Trans>Unassigned</Trans>
              </span>
            );
          }
          return <EmployeeAvatar employeeId={assignee} size="xs" />;
        },
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          }
        }
      },
      {
        accessorKey: "priority",
        header: t`Priority`,
        cell: ({ row }) => (
          <MaintenancePriority priority={row.original.priority} />
        ),
        meta: {
          icon: <LuChartNoAxesColumnIncreasing />,
          filter: {
            type: "static",
            options: serviceJobPriorities.map((priority) => ({
              value: priority,
              label: <MaintenancePriority priority={priority} />
            }))
          },
          pluralHeader: t`Priorities`
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: ({ row }) => formatDate(row.original.dueDate) || "—",
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created`,
        cell: ({ row }) => (
          <DateTime value={row.original.createdAt} variant="date" />
        ),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
  }, [coverageLabels, customers, formatDate, people, t, workSiteLabels]);

  const renderContextMenu = useCallback(
    (row: ServiceJob) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.edit}
        onClick={() => navigate(path.to.serviceJob(row.id))}
      >
        <MenuIcon icon={<LuPencil />} />
        <Trans>Edit Job</Trans>
      </MenuItem>
    ),
    [navigate]
  );

  return (
    <Table<ServiceJob>
      data={data}
      columns={columns}
      count={count}
      defaultColumnPinning={{
        left: ["serviceJobId"]
      }}
      defaultColumnVisibility={{
        priority: false
      }}
      primaryAction={
        permissions.can("create", "service") && (
          <New
            label={t`Job`}
            to={`${path.to.newServiceJob}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Service Jobs`}
      table="serviceJob"
      withSavedView
    />
  );
});

ServiceJobsTable.displayName = "ServiceJobsTable";
export default ServiceJobsTable;
