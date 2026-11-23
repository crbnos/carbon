// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectPool } from "@carbon/ee/indirect-rates";
import {
  indirectBaseTypes,
  indirectPoolTypes
} from "@carbon/ee/indirect-rates";
import {
  Checkbox,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBoxes,
  LuCheck,
  LuFolderKanban,
  LuListOrdered,
  LuPencil,
  LuScale,
  LuTag,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Empty, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type IndirectPoolsTableProps = {
  data: IndirectPool[];
  count: number;
};

/** Accounting → Indirect Pools: the pools in cascade order (Phase 5b). */
const IndirectPoolsTable = memo(({ data, count }: IndirectPoolsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const isFiltered = params.has("filter") || params.has("search");
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<IndirectPool>[]>(
    () => [
      {
        accessorKey: "sequence",
        header: t`Sequence`,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.sequence}</span>
        ),
        meta: { icon: <LuListOrdered /> }
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.indirectPool(row.original.id)}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: { icon: <LuBoxes /> }
      },
      {
        accessorKey: "poolType",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={row.original.poolType} />,
        meta: {
          filter: {
            type: "static",
            options: indirectPoolTypes.map((type) => ({
              value: type,
              label: <Enumerable value={type} />
            }))
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "baseType",
        header: t`Base`,
        cell: ({ row }) => <Enumerable value={row.original.baseType} />,
        meta: {
          filter: {
            type: "static",
            options: indirectBaseTypes.map((type) => ({
              value: type,
              label: <Enumerable value={type} />
            }))
          },
          icon: <LuScale />
        }
      },
      {
        accessorKey: "appliesToProjects",
        header: t`Applies to Projects`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: { icon: <LuFolderKanban /> }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: { icon: <LuCheck /> }
      }
    ],
    [t]
  );

  const renderContextMenu = useCallback(
    (row: IndirectPool) => (
      <>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          disabled={!permissions.can("update", "accounting")}
          onClick={() => navigate(path.to.indirectPool(row.id))}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Pool</Trans>
        </MenuItem>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.delete}
          destructive
          disabled={!permissions.can("delete", "accounting")}
          onClick={() => navigate(path.to.deleteIndirectPool(row.id))}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Pool</Trans>
        </MenuItem>
      </>
    ),
    [navigate, permissions]
  );

  return (
    <Table<IndirectPool>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Pool`} to={path.to.newIndirectPool} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Indirect Pools`}
      emptyState={
        isFiltered ? undefined : (
          <Empty
            title={t`No indirect pools yet`}
            description={t`A pool collects indirect cost and spreads it over its base.`}
          />
        )
      }
    />
  );
});

IndirectPoolsTable.displayName = "IndirectPoolsTable";
export default IndirectPoolsTable;
