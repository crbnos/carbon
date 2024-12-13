import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuTrash, LuUsers } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { EmployeeType } from "~/modules/users";
import { path } from "~/utils/path";

type EmployeeTypesTableProps = {
  data: EmployeeType[];
  count: number;
};

const EmployeeTypesTable = memo(({ data, count }: EmployeeTypesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Employee Type",
        cell: ({ row, getValue }) =>
          row.original.protected ? (
            <Enumerable
              value={row.original.name}
              className="cursor-not-allowed"
            />
          ) : (
            <Enumerable
              value={row.original.name}
              onClick={() => navigate(row.original.id)}
              className="cursor-pointer"
            />
          ),
        meta: {
          icon: <LuUsers />,
        },
      },
    ];
  }, [navigate]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.employeeAccounts}?filter=employeeTypeId:eq:${row.id}`
              );
            }}
          >
            <MenuIcon icon={<BsPeopleFill />} />
            View Employees
          </MenuItem>
          <MenuItem
            disabled={row.protected || !permissions.can("update", "users")}
            onClick={() => {
              navigate(`${path.to.employeeType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Employee Type
          </MenuItem>
          <MenuItem
            destructive
            disabled={row.protected || !permissions.can("delete", "users")}
            onClick={() => {
              navigate(
                `${path.to.deleteEmployeeType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Employee Type
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "users") && (
          <New label="Employee Type" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

EmployeeTypesTable.displayName = "EmployeeTypesTable";
export default EmployeeTypesTable;
