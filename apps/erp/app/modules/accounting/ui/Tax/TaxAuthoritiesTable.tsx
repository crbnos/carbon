// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuPencil, LuTrash, LuUser } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, SupplierAvatar, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import type { getTaxAuthorities } from "../../accounting.service";

type TaxAuthority = NonNullable<
  Awaited<ReturnType<typeof getTaxAuthorities>>["data"]
>[number];

type TaxAuthoritiesTableProps = {
  data: TaxAuthority[];
  count: number;
};

const TaxAuthoritiesTable = memo(
  ({ data, count }: TaxAuthoritiesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [suppliers] = useSuppliers();
    const customColumns = useCustomColumns<TaxAuthority>("taxAuthority");

    const columns = useMemo<ColumnDef<TaxAuthority>[]>(() => {
      const defaultColumns: ColumnDef<TaxAuthority>[] = [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={`${row.original.id}?${params.toString()}`}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />
          }
        },
        {
          id: "supplierId",
          header: t`Supplier`,
          cell: ({ row }) =>
            row.original.supplierId ? (
              <SupplierAvatar supplierId={row.original.supplierId} />
            ) : null,
          meta: {
            mobile: "P2",
            filter: {
              type: "static",
              options: suppliers?.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))
            },
            icon: <LuUser />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [params, customColumns, suppliers, t]);

    const renderContextMenu = useCallback(
      (row: TaxAuthority) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={!permissions.can("update", "accounting")}
              onClick={() => {
                navigate(
                  `${path.to.taxAuthority(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Tax Authority</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={!permissions.can("delete", "accounting")}
              onClick={() => {
                navigate(
                  `${path.to.deleteTaxAuthority(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Tax Authority</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<TaxAuthority>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <New label={t`Tax Authority`} to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Tax Authorities`}
      />
    );
  }
);

TaxAuthoritiesTable.displayName = "TaxAuthoritiesTable";
export default TaxAuthoritiesTable;
