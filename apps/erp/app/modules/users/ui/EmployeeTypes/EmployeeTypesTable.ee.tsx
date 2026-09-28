import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuTrash, LuUsers } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { EmployeeType } from "~/modules/users";
import { path } from "~/utils/path";

type EmployeeTypesTableProps = {
  data: EmployeeType[];
  count: number;
};

const EmployeeTypesTable = memo(({ data, count }: EmployeeTypesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Employee Type`,
        cell: ({ row, getValue }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} className="cursor-pointer" />
          </Hyperlink>
        ),

        meta: {
          icon: <LuUsers />
        }
      }
    ];
  }, [t]);

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
            <Trans>View Employees</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("update", "users")}
            onClick={() => {
              navigate(`${path.to.employeeType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Employee Type</Trans>
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
            <Trans>Delete Employee Type</Trans>
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
          <New label={t`Employee Type`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Employee Types`}
    />
  );
});

EmployeeTypesTable.displayName = "EmployeeTypesTable";
export default EmployeeTypesTable;
