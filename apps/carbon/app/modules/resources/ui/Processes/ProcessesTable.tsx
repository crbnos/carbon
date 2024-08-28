import {
  Avatar,
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  Badge,
  MenuIcon,
  MenuItem,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { EmployeeAvatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { type Process } from "~/modules/resources";
import { standardFactorType } from "~/modules/shared";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ProcessesTableProps = {
  data: Process[];
  count: number;
};

const defaultColumnVisibility = {
  createdAt: false,
  createdBy: false,
  updatedAt: false,
  updatedBy: false,
};

const ProcessesTable = memo(({ data, count }: ProcessesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const [people] = usePeople();

  const customColumns = useCustomColumns<Process>("process");
  const columns = useMemo<ColumnDef<Process>[]>(() => {
    const defaultColumns: ColumnDef<Process>[] = [
      {
        accessorKey: "name",
        header: "Process",
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id!)}
            className="cursor-pointer"
          />
        ),
      },
      {
        accessorKey: "processType",
        header: "Process Type",
        cell: (item) =>
          item.getValue() === "Outside" ? (
            <Badge>Outside</Badge>
          ) : (
            <Badge variant="secondary">{item.getValue<string>()}</Badge>
          ),
      },
      {
        id: "workCenters",
        header: "Work Centers",
        cell: ({ row }) => (
          <span className="flex gap-2 items-center flex-wrap py-2">
            {((row.original.workCenters ?? []) as Array<ListItem>).map((wc) => (
              <Badge
                key={wc.name}
                variant="secondary"
                onClick={() => navigate(path.to.workCenter(wc.id))}
                className="cursor-pointer"
              >
                {wc.name}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        accessorKey: "defaultStandardFactor",
        header: "Default Unit",
        cell: (item) => item.getValue(),
        meta: {
          filter: {
            type: "static",
            options: standardFactorType.map((type) => ({
              value: type,
              label: type,
            })),
          },
        },
      },
      {
        id: "suppliers",
        header: "Suppliers",
        cell: ({ row }) => (
          <AvatarGroup limit={5}>
            <AvatarGroupList>
              {((row.original.suppliers ?? []) as Array<{ name: string }>).map(
                (s) => (
                  <Avatar key={s.name} name={s.name} />
                )
              )}
            </AvatarGroupList>
            <AvatarOverflowIndicator />
          </AvatarGroup>
        ),
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
      {
        id: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [people, customColumns, navigate]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.process(row.id!)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Process
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteProcess(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Process
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Process>
      data={data}
      count={count}
      columns={columns}
      defaultColumnVisibility={defaultColumnVisibility}
      primaryAction={
        permissions.can("create", "resources") && (
          <New label="Process" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

ProcessesTable.displayName = "ProcessesTable";
export default ProcessesTable;
