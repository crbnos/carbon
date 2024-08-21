import { Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { EmployeeAvatar, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { standardFactorType, type Process } from "~/modules/resources";
import { usePeople } from "~/stores";
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
        id: "workCenters",
        header: "Work Centers",
        cell: ({ row }) => (
          <span className="flex gap-2 items-center flex-wrap py-2">
            {((row.original.workCenters ?? []) as Array<{ name: string }>).map(
              (wc) => (
                <Enumerable key={wc.name} value={wc.name} />
              )
            )}
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
