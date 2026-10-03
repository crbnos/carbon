// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuCircleAlert, LuPencil, LuShapes, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { maintenanceFailureModeType } from "../../resources.models";
import type { FailureMode } from "../../types";

type FailureModesTableProps = {
  data: FailureMode[];
  count: number;
};

const FailureModesTable = memo(({ data, count }: FailureModesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<FailureMode>[]>(() => {
    const defaultColumns: ColumnDef<FailureMode>[] = [
      {
        accessorKey: "name",
        header: t`Failure Mode`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: {
          icon: <LuCircleAlert />
        }
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={row.original.type} />,
        meta: {
          icon: <LuShapes />,
          filter: {
            type: "static",
            options: maintenanceFailureModeType.map((type) => ({
              label: <Enumerable value={type} />,
              value: type
            }))
          }
        }
      }
    ];
    return [...defaultColumns];
  }, [t]);

  const renderContextMenu = useCallback(
    (row: FailureMode) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(`${path.to.failureMode(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Failure Mode</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteFailureMode(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Failure Mode</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<FailureMode>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "resources") && (
          <New
            label={t`Failure Mode`}
            to={`${path.to.newFailureMode}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Failure Modes`}
    />
  );
});

FailureModesTable.displayName = "FailureModesTable";
export default FailureModesTable;
