import { Combobox, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBuilding,
  LuCalendar,
  LuChartNoAxesColumnIncreasing,
  LuCircleAlert,
  LuDna,
  LuPencil,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useWorkCenters } from "~/components/Form/WorkCenters";
import { usePermissions, useUrlParams } from "~/hooks";
import { usePeople } from "~/stores";
import { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  maintenanceDispatchPriority,
  maintenanceDispatchStatus,
  maintenanceSource,
  oeeImpact
} from "../../resources.models";
import type { MaintenanceDispatch } from "../../types";
import MaintenanceOeeImpact from "./MaintenanceOeeImpact";
import MaintenancePriority from "./MaintenancePriority";
import MaintenanceSource from "./MaintenanceSource";
import MaintenanceStatus from "./MaintenanceStatus";

type MaintenanceDispatchesTableProps = {
  data: MaintenanceDispatch[];
  count: number;
  failureModes: ListItem[];
  locations: { id: string; name: string }[];
  locationId: string | null;
};

const MaintenanceDispatchesTable = memo(
  ({
    data,
    count,
    failureModes,
    locations,
    locationId
  }: MaintenanceDispatchesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const workCenters = useWorkCenters();
    const [people] = usePeople();

    const locationOptions = useMemo(
      () =>
        locations.map((location) => ({
          value: location.id,
          label: location.name
        })),
      [locations]
    );

    const getLocationPath = (locId: string) => {
      return `${path.to.maintenanceDispatches}?location=${locId}`;
    };

    const columns = useMemo<ColumnDef<MaintenanceDispatch>[]>(() => {
      return [
        {
          accessorKey: "maintenanceDispatchId",
          header: "Dispatch ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.maintenanceDispatch(row.original.id)}>
              {row.original.maintenanceDispatchId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "workCenterId",
          header: "Work Center",
          cell: ({ row }) => {
            const workCenterId = row.original.workCenterId;
            if (!workCenterId) {
              return <span className="text-muted-foreground">Unassigned</span>;
            }
            const workCenter = workCenters.find(
              (wc) => wc.value === workCenterId
            );
            if (!workCenter) {
              return <span className="text-muted-foreground">Unknown</span>;
            }
            return (
              <Hyperlink to={path.to.workCenter(workCenterId)}>
                <Enumerable value={workCenter.label} />
              </Hyperlink>
            );
          },
          meta: {
            icon: <LuBuilding />,
            filter: {
              type: "static",
              options: workCenters.map((wc) => ({
                value: wc.value,
                label: <Enumerable value={wc.label} />
              }))
            }
          }
        },
        {
          accessorKey: "source",
          header: "Source",
          cell: (item) => {
            const source = item.getValue<(typeof maintenanceSource)[number]>();
            return <MaintenanceSource source={source} />;
          },
          meta: {
            icon: <LuDna />,
            filter: {
              type: "static",
              options: maintenanceSource.map((source) => ({
                value: source,
                label: source
              }))
            }
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: (item) => {
            const status =
              item.getValue<(typeof maintenanceDispatchStatus)[number]>();
            return <MaintenanceStatus status={status} />;
          },
          meta: {
            icon: <LuStar />,
            filter: {
              type: "static",
              options: maintenanceDispatchStatus.map((status) => ({
                value: status,
                label: <MaintenanceStatus status={status} />
              }))
            },
            pluralHeader: "Statuses"
          }
        },
        {
          accessorKey: "priority",
          header: "Priority",
          cell: (item) => {
            const priority =
              item.getValue<(typeof maintenanceDispatchPriority)[number]>();
            return <MaintenancePriority priority={priority} />;
          },
          meta: {
            icon: <LuChartNoAxesColumnIncreasing />,
            filter: {
              type: "static",
              options: maintenanceDispatchPriority.map((priority) => ({
                value: priority,
                label: <MaintenancePriority priority={priority} />
              }))
            },
            pluralHeader: "Priorities"
          }
        },
        {
          accessorKey: "oeeImpact",
          header: "OEE Impact",
          cell: (item) => {
            const impact = item.getValue<(typeof oeeImpact)[number]>();
            return <MaintenanceOeeImpact oeeImpact={impact} />;
          },
          meta: {
            icon: <LuChartNoAxesColumnIncreasing />,
            filter: {
              type: "static",
              options: oeeImpact.map((impact) => ({
                value: impact,
                label: <MaintenanceOeeImpact oeeImpact={impact} />
              }))
            }
          }
        },
        {
          accessorKey: "plannedStartTime",
          header: "Planned Start",
          cell: ({ row }) => {
            const date = row.original.plannedStartTime;
            return date ? formatDate(date) : "-";
          },
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "assignee",
          header: "Assignee",
          cell: ({ row }) => {
            const assignee = row.original.assignee;
            if (!assignee) {
              return <span className="text-muted-foreground">Unassigned</span>;
            }
            return (
              <HStack>
                <EmployeeAvatar employeeId={assignee} size="xs" />
              </HStack>
            );
          },
          meta: {
            icon: <LuUser />
          }
        },
        {
          accessorKey: "actualFailureModeId",
          header: "Actual Failure Mode",
          cell: ({ row }) => {
            const actualFailureModeId = row.original.actualFailureModeId;
            const failureMode = failureModes.find(
              (mode) => mode.id === actualFailureModeId
            );
            if (!actualFailureModeId) {
              return null;
            }
            return <Enumerable value={failureMode?.name ?? null} />;
          },
          meta: {
            icon: <LuCircleAlert />,
            filter: {
              type: "static",
              options: failureModes?.map((mode) => ({
                value: mode.id,
                label: <Enumerable value={mode.name} />
              }))
            }
          }
        },
        {
          accessorKey: "suspectedFailureModeId",
          header: "Suspected Failure Mode",
          cell: ({ row }) => {
            const suspectedFailureModeId = row.original.suspectedFailureModeId;
            const failureMode = failureModes.find(
              (mode) => mode.id === suspectedFailureModeId
            );
            if (!suspectedFailureModeId) {
              return null;
            }
            return <Enumerable value={failureMode?.name ?? null} />;
          },
          meta: {
            icon: <LuCircleAlert />,
            filter: {
              type: "static",
              options: failureModes?.map((mode) => ({
                value: mode.id,
                label: <Enumerable value={mode.name} />
              }))
            }
          }
        },
        {
          accessorKey: "createdBy",
          header: "Created By",
          cell: ({ row }) => {
            const createdBy = row.original.createdBy;
            return <EmployeeAvatar employeeId={createdBy} size="xs" />;
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
          accessorKey: "createdAt",
          header: "Created At",
          cell: ({ row }) => {
            const date = row.original.createdAt;
            return date ? formatDate(date) : "-";
          },
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => {
            const updatedBy = row.original.updatedBy;
            return <EmployeeAvatar employeeId={updatedBy} size="xs" />;
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
          accessorKey: "updatedAt",
          header: "Updated At",
          cell: ({ row }) => {
            const date = row.original.updatedAt;
            return date ? formatDate(date) : "-";
          },
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
    }, [workCenters]);

    const renderContextMenu = useCallback(
      (row: MaintenanceDispatch) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(path.to.maintenanceDispatch(row.id));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Dispatch
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "resources")}
              onClick={() => {
                navigate(
                  `${path.to.deleteMaintenanceDispatch(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Dispatch
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<MaintenanceDispatch>
        data={data}
        columns={columns}
        defaultColumnPinning={{
          left: ["maintenanceDispatchId"]
        }}
        defaultColumnVisibility={{
          suspectedFailureModeId: false,
          createdBy: false,
          createdAt: false,
          updatedBy: false,
          updatedAt: false
        }}
        count={count}
        primaryAction={
          <div className="flex items-center gap-2">
            {locationId && (
              <Combobox
                asButton
                size="sm"
                value={locationId}
                options={locationOptions}
                onChange={(selected) => {
                  // hard refresh because initialValues update has no effect otherwise
                  window.location.href = getLocationPath(selected);
                }}
              />
            )}
            {permissions.can("create", "resources") && (
              <New
                label="Dispatch"
                to={`${path.to.newMaintenanceDispatch}?${params.toString()}`}
              />
            )}
          </div>
        }
        renderContextMenu={renderContextMenu}
        title="Maintenance Dispatches"
      />
    );
  }
);

MaintenanceDispatchesTable.displayName = "MaintenanceDispatchesTable";
export default MaintenanceDispatchesTable;
