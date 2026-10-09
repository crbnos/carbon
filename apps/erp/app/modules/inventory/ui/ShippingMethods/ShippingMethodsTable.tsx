// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBanknote,
  LuBookMarked,
  LuGlobe,
  LuPencil,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ShippingMethod } from "~/modules/inventory";
import { shippingCarrierType } from "~/modules/inventory";
import { path } from "~/utils/path";

type ShippingMethodsTableProps = {
  data: ShippingMethod[];
  count: number;
};

const ShippingMethodsTable = memo(
  ({ data, count }: ShippingMethodsTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const hasAccounting =
      permissions.has("accounting") && permissions.can("view", "accounting");

    const rows = useMemo(() => data, [data]);

    const customColumns =
      useCustomColumns<(typeof data)[number]>("shippingMethod");

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      let result: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: t`Name`,
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
            mobile: "P1",
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "carrier",
          header: t`Carrier`,
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            mobile: "P2",
            filter: {
              type: "static",
              options: shippingCarrierType.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuTruck />
          }
        },
        {
          accessorKey: "trackingUrl",
          header: t`Tracking URL`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuGlobe />
          }
        }
      ];
      result = [...result, ...customColumns];

      return hasAccounting
        ? result.concat([
            {
              accessorKey: "carrierAccountId",
              header: t`Carrier Account`,
              cell: (item) => item.getValue(),
              meta: {
                icon: <LuBanknote />
              }
            }
          ])
        : result;
    }, [permissions, customColumns]);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.shippingMethod(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Shipping Method</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={!permissions.can("delete", "inventory")}
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteShippingMethod(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Shipping Method</Trans>
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
              label={t`Shipping Method`}
              to={`${path.to.newShippingMethod}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Shipping Methods`}
      />
    );
  }
);

ShippingMethodsTable.displayName = "ShippingMethodsTable";
export default ShippingMethodsTable;
