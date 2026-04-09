import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuShapes, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { CustomerType } from "../../types";

type CustomerTypesTableProps = {
  data: CustomerType[];
  count: number;
};

const CustomerTypesTable = memo(({ data, count }: CustomerTypesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<CustomerType>("customerType");
  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Customer Type`,
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id)}
            className="cursor-pointer"
          />
        ),
        meta: {
          icon: <LuShapes />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [navigate, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.customers}?filter=type:eq:${row.name}`);
            }}
          >
            <MenuIcon icon={<BsPeopleFill />} />
            <Trans>View Customers</Trans>
          </MenuItem>
          <MenuItem
            disabled={row.protected || !permissions.can("update", "sales")}
            onClick={() => {
              navigate(`${path.to.customerType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Customer Type</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={row.protected || !permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteCustomerType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Customer Type</Trans>
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
        permissions.can("create", "sales") && (
          <New
            label={t`Customer Types`}
            to={`${path.to.newCustomerType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Customer Types`}
    />
  );
});

CustomerTypesTable.displayName = "CustomerTypesTable";
export default CustomerTypesTable;
