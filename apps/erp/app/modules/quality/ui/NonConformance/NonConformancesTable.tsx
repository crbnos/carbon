import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuChartNoAxesColumnIncreasing,
  LuCircleGauge,
  LuDna,
  LuMap,
  LuOctagonX,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";

import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import type { ListItem } from "~/types";
import type { NonConformance } from "../../types";
import { getPriorityIcon, getSourceIcon } from "./NonConformanceIcons";
import NonConformanceStatus from "./NonConformanceStatus";
import { Enumerable } from "~/components/Enumerable";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useLocations } from "~/components/Form/Location";
import { formatDate } from "@carbon/utils";
import {
  nonConformancePriority,
  nonConformanceSource,
  nonConformanceStatus,
} from "../../quality.models";
import { usePeople } from "~/stores/people";

type NonConformancesTableProps = {
  data: NonConformance[];
  types: ListItem[];
  count: number;
};

const NonConformancesTable = memo(
  ({ data, types, count }: NonConformancesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedNonConformance, setSelectedNonConformance] =
      useState<NonConformance | null>(null);

    const customColumns = useCustomColumns<NonConformance>("nonConformance");
    const locations = useLocations();
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<NonConformance>[]>(() => {
      const defaultColumns: ColumnDef<NonConformance>[] = [
        {
          accessorKey: "nonConformanceId",
          header: "Name",
          cell: ({ row }) => (
            <Hyperlink to={path.to.nonConformance(row.original.id!)}>
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  {row.original.nonConformanceId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.original.name}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <NonConformanceStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCircleGauge />,
            filter: {
              type: "static",
              options: nonConformanceStatus.map((status) => ({
                label: status,
                value: status,
              })),
            },
          },
        },
        {
          accessorKey: "nonConformanceTypeId",
          header: "Type",
          cell: ({ row }) => (
            <Enumerable
              value={
                types.find(
                  (type) => type.id === row.original.nonConformanceTypeId
                )?.name ?? null
              }
            />
          ),
          meta: {
            icon: <LuOctagonX />,
            filter: {
              type: "static",
              options: types.map((type) => ({
                label: type.name,
                value: type.id,
              })),
            },
          },
        },
        {
          accessorKey: "priority",
          header: "Priority",
          cell: ({ row }) => (
            <div className="flex gap-2 items-center">
              {getPriorityIcon(row.original.priority ?? "Low", false)}
              {row.original.priority}
            </div>
          ),
          meta: {
            icon: <LuChartNoAxesColumnIncreasing />,
            filter: {
              type: "static",
              options: nonConformancePriority.map((priority) => ({
                label: priority,
                value: priority,
              })),
            },
          },
        },
        {
          accessorKey: "source",
          header: "Source",
          cell: ({ row }) => (
            <div className="flex gap-2 items-center">
              {getSourceIcon(row.original.source ?? "Internal", false)}
              {row.original.source}
            </div>
          ),
          meta: {
            icon: <LuDna />,
            filter: {
              type: "static",
              options: nonConformanceSource.map((source) => ({
                label: source,
                value: source,
              })),
            },
          },
        },
        {
          accessorKey: "locationId",
          header: "Location",
          cell: ({ row }) => (
            <Enumerable
              value={
                locations.find(
                  (location) => location.value === row.original.locationId
                )?.label ?? null
              }
            />
          ),
          meta: {
            icon: <LuMap />,
            filter: {
              type: "static",
              options: locations.map((location) => ({
                label: location.label,
                value: location.value,
              })),
            },
          },
        },
        {
          accessorKey: "assignee",
          header: "Assignee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "openDate",
          header: "Open Date",
          cell: ({ row }) => formatDate(row.original.openDate),
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "closeDate",
          header: "Closed Date",
          cell: ({ row }) => formatDate(row.original.closeDate),
          meta: {
            icon: <LuCalendar />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, locations, people, types]);

    const renderContextMenu = useCallback(
      (row: NonConformance) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.nonConformance(row.id!)}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Non-Conformance
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedNonConformance(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Non-Conformance
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<NonConformance>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New label="Non-Conformance" to={path.to.newNonConformance} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Non-Conformances"
          table="nonConformance"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedNonConformance && (
          <ConfirmDelete
            action={path.to.deleteNonConformance(selectedNonConformance.id!)}
            isOpen
            onCancel={() => {
              setSelectedNonConformance(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedNonConformance(null);
              deleteDisclosure.onClose();
            }}
            name={selectedNonConformance.name ?? "non-conformance"}
            text="Are you sure you want to delete this non-conformance?"
          />
        )}
      </>
    );
  }
);

NonConformancesTable.displayName = "NonConformancesTable";
export default NonConformancesTable;
