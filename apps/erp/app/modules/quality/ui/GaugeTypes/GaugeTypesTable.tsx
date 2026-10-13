// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuCircleGauge, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { GaugeType } from "../../types";

type GaugeTypesTableProps = {
  data: GaugeType[];
  count: number;
};

const GaugeTypesTable = memo(({ data, count }: GaugeTypesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<GaugeType>("gaugeType");

  const columns = useMemo<ColumnDef<GaugeType>[]>(() => {
    const defaultColumns: ColumnDef<GaugeType>[] = [
      {
        accessorKey: "name",
        header: t`Gauge Type`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuCircleGauge />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, t]);

  const renderContextMenu = useCallback(
    (row: GaugeType) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(`${path.to.gaugeType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Type
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteGaugeType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Type
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<GaugeType>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "quality") && (
          <New
            label={t`Gauge Type`}
            to={`${path.to.newGaugeType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Gauge Types`}
    />
  );
});

GaugeTypesTable.displayName = "GaugeTypesTable";
export default GaugeTypesTable;
