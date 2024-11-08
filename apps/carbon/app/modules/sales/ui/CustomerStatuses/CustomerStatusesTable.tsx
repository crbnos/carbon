import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuStar, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { CustomerStatus } from "~/modules/sales";
import { path } from "~/utils/path";

type CustomerStatusesTableProps = {
  data: CustomerStatus[];
  count: number;
};

const CustomerStatusesTable = memo(
  ({ data, count }: CustomerStatusesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<CustomerStatus>("customerStatus");
    const columns = useMemo<ColumnDef<CustomerStatus>[]>(() => {
      const defaultColumns: ColumnDef<CustomerStatus>[] = [
        {
          accessorKey: "name",
          header: "Customer Status",
          cell: ({ row }) => (
            <Enumerable
              value={row.original.name}
              onClick={() => navigate(row.original.id)}
              className="cursor-pointer"
            />
          ),
          meta: {
            icon: <LuStar />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [navigate, customColumns]);

    const renderContextMenu = useCallback(
      (row: CustomerStatus) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(`${path.to.customers}?filter=status:eq:${row.name}`);
              }}
            >
              <MenuIcon icon={<BsPeopleFill />} />
              View Customers
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.customerStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Customer Status
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteCustomerStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Customer Status
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<CustomerStatus>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label="Customer Status"
              to={`${path.to.newCustomerStatus}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

CustomerStatusesTable.displayName = "CustomerStatusesTable";
export default CustomerStatusesTable;
