// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { asColor } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuStar, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { SupplierStage } from "../../types";

type SupplierStagesTableProps = {
  data: SupplierStage[];
  count: number;
  infinite: InfiniteOptions;
};

const SupplierStagesTable = memo(
  ({ data, count, infinite }: SupplierStagesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<SupplierStage>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Supplier Stage`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable
                value={row.original.name ?? ""}
                color={asColor(row.original.color)}
              />
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuStar />
          }
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: SupplierStage) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.view}
              onClick={() => {
                navigate(
                  `${path.to.suppliers}?filter=supplierStageId:eq:${row.id}`
                );
              }}
            >
              <MenuIcon icon={<BsPeopleFill />} />
              <Trans>View Suppliers</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              onClick={() => {
                navigate(
                  `${path.to.supplierStage(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Supplier Stage</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={!permissions.can("delete", "purchasing")}
              onClick={() => {
                navigate(
                  `${path.to.deleteSupplierStage(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Supplier Stage</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<SupplierStage>
        data={data}
        columns={columns}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "purchasing") && (
            <New
              label={t`Supplier Stage`}
              to={`${path.to.newSupplierStage}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Supplier Stages`}
      />
    );
  }
);

SupplierStagesTable.displayName = "SupplierStagesTable";
export default SupplierStagesTable;
