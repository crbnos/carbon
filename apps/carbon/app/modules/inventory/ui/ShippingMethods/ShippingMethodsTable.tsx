import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBanknote,
  LuBookMarked,
  LuGlobe,
  LuPencil,
  LuTrash,
  LuTruck,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { shippingCarrierType, type ShippingMethod } from "~/modules/inventory";
import { path } from "~/utils/path";

type ShippingMethodsTableProps = {
  data: ShippingMethod[];
  count: number;
};

const ShippingMethodsTable = memo(
  ({ data, count }: ShippingMethodsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const hasAccounting =
      permissions.has("accounting") && permissions.can("view", "accounting");

    const rows = useMemo(() => data, [data]);

    const customColumns =
      useCustomColumns<(typeof data)[number]>("shippingMethod");

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      let result: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.shippingMethod(
                row.original.id
              )}?${params.toString()}`}
            >
              {row.original.name}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "carrier",
          header: "Carrier",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: shippingCarrierType.map((v) => ({
                label: v,
                value: v,
              })),
            },
            icon: <LuTruck />,
          },
        },
        {
          accessorKey: "trackingUrl",
          header: "Tracking URL",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuGlobe />,
          },
        },
      ];
      result = [...result, ...customColumns];

      return hasAccounting
        ? result.concat([
            {
              accessorKey: "carrierAccountId",
              header: "Carrier Account",
              cell: (item) => item.getValue(),
              meta: {
                icon: <LuBanknote />,
              },
            },
          ])
        : result;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [permissions, customColumns]);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.shippingMethod(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Shipping Method
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.deleteShippingMethod(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Shipping Method
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
          permissions.can("create", "inventory") && (
            <New
              label="Shipping Method"
              to={`${path.to.newShippingMethod}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

ShippingMethodsTable.displayName = "ShippingMethodsTable";
export default ShippingMethodsTable;
