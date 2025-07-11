import type { Database } from "@carbon/database";
import { Copy, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuExternalLink,
  LuPencil,
  LuSquareUser,
  LuTrash,
} from "react-icons/lu";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type CustomerPortal = Database["public"]["Tables"]["externalLink"]["Row"];

type CustomerPortalsTableProps = {
  appUrl: string;
  data: CustomerPortal[];
  count: number;
};

const CustomerPortalsTable = memo(
  ({ appUrl, data, count }: CustomerPortalsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<CustomerPortal>[]>(() => {
      const defaultColumns: ColumnDef<CustomerPortal>[] = [
        {
          accessorKey: "customer.name",
          header: "Customer",
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.customer(
                row.original.customerId ?? row.original.documentId ?? ""
              )}
            >
              <CustomerAvatar
                customerId={
                  row.original.customerId ?? row.original.documentId ?? ""
                }
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuSquareUser />,
          },
        },
        {
          accessorKey: "portalLink",
          header: "Portal Link",
          cell: ({ row }) => {
            const portalUrl = `${appUrl}/share/customer/${row.original.id}`;
            return (
              <div className="flex items-center gap-2">
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono underline"
                >
                  {portalUrl}
                </a>
                <Copy text={portalUrl} />
              </div>
            );
          },
          meta: {
            icon: <LuExternalLink />,
          },
        },
      ];
      return defaultColumns;
    }, [appUrl]);

    const renderContextMenu = useCallback(
      (row: CustomerPortal) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.customerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Portal
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteCustomerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Portal
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<CustomerPortal>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label="Customer Portal"
              to={`${path.to.newCustomerPortal}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Customer Portals"
      />
    );
  }
);

CustomerPortalsTable.displayName = "CustomerPortalsTable";
export default CustomerPortalsTable;
