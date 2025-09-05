import { Badge, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
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
  LuSquareStack,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";

import { formatDate } from "@carbon/utils";
import { flushSync } from "react-dom";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useItems } from "~/stores/items";
import { usePeople } from "~/stores/people";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  nonConformancePriority,
  nonConformanceSource,
  nonConformanceStatus,
} from "../../quality.models";
import type { Issue } from "../../types";
import { getPriorityIcon, getSourceIcon } from "./IssueIcons";
import IssueStatus from "./IssueStatus";

type IssuesTableProps = {
  data: Issue[];
  types: ListItem[];
  count: number;
};

const IssuesTable = memo(({ data, types, count }: IssuesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const deleteDisclosure = useDisclosure();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  const customColumns = useCustomColumns<Issue>("nonConformance");
  const locations = useLocations();
  const [people] = usePeople();
  const [items] = useItems();

  const columns = useMemo<ColumnDef<Issue>[]>(() => {
    const defaultColumns: ColumnDef<Issue>[] = [
      {
        accessorKey: "nonConformanceId",
        header: "Name",
        cell: ({ row }) => (
          <Hyperlink to={path.to.issue(row.original.id!)}>
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
        cell: ({ row }) => <IssueStatus status={row.original.status} />,
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
        id: "items",
        header: "Items",
        cell: ({ row }) => (
          <span className="flex gap-2 items-center flex-wrap py-2">
            {((row.original.items ?? []) as Array<string>).map((i) => {
              const item = items.find((x) => x.id === i);
              if (!item) return null;
              return (
                <Badge variant="outline" key={item?.id}>
                  {item?.readableIdWithRevision}
                </Badge>
              );
            })}
          </span>
        ),
        meta: {
          icon: <LuSquareStack />,
          filter: {
            type: "static",
            options: items.map((item) => ({
              value: item.id,
              label: (
                <Badge variant="outline">{item.readableIdWithRevision}</Badge>
              ),
            })),
            isArray: true,
          },
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
  }, [customColumns, items, locations, people, types]);

  const renderContextMenu = useCallback(
    (row: Issue) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "quality")}
            onClick={() => {
              navigate(`${path.to.issue(row.id!)}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Issue
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "quality")}
            onClick={() => {
              flushSync(() => {
                setSelectedIssue(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Issue
          </MenuItem>
        </>
      );
    },
    [navigate, permissions, deleteDisclosure]
  );

  return (
    <>
      <Table<Issue>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "quality") && (
            <New label="Issue" to={path.to.newIssue} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Issues"
        table="nonConformance"
        withSavedView
      />
      {deleteDisclosure.isOpen && selectedIssue && (
        <ConfirmDelete
          action={path.to.deleteIssue(selectedIssue.id!)}
          isOpen
          onCancel={() => {
            setSelectedIssue(null);
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedIssue(null);
            deleteDisclosure.onClose();
          }}
          name={selectedIssue.name ?? "issue"}
          text="Are you sure you want to delete this issue?"
        />
      )}
    </>
  );
});

IssuesTable.displayName = "IssuesTable";
export default IssuesTable;
