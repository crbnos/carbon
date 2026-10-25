// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Checkbox,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuCode,
  LuPencil,
  LuToggleLeft,
  LuToggleRight,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import { EACH_UNIT_OF_MEASURE_CODE } from "../../items.models";
import type { UnitOfMeasure } from "../../types";

type UnitOfMeasuresTableProps = {
  data: UnitOfMeasure[];
  count: number;
};

const UnitOfMeasuresTable = memo(
  ({ data, count }: UnitOfMeasuresTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<UnitOfMeasure>("unitOfMeasure");
    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "code",
          header: t`Code`,
          cell: (item) => item.getValue(),
          meta: {
            mobile: "P2",
            icon: <LuCode />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: t`Active` },
                { value: "false", label: t`Inactive` }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, t]);

    // Every company holds the standard units of both measurement systems;
    // the other system's start inactive and are turned on here.
    const fetcher = useFetcher();
    const onSetActive = useCallback(
      (selectedRows: (typeof data)[number][], active: boolean) => {
        const formData = new FormData();
        for (const row of selectedRows) formData.append("ids", row.id);
        formData.append("active", String(active));
        fetcher.submit(formData, {
          method: "post",
          action: path.to.uomActive
        });
      },
      [fetcher]
    );

    const renderActions = useCallback(
      (selectedRows: (typeof data)[number][]) => (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>
            <Trans>Update</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={
              !permissions.can("update", "parts") || fetcher.state !== "idle"
            }
            onClick={() => onSetActive(selectedRows, true)}
          >
            <DropdownMenuIcon icon={<LuToggleRight />} />
            <Trans>Turn On</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              !permissions.can("update", "parts") || fetcher.state !== "idle"
            }
            onClick={() => onSetActive(selectedRows, false)}
          >
            <DropdownMenuIcon icon={<LuToggleLeft />} />
            <Trans>Turn Off</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      ),
      [fetcher.state, onSetActive, permissions]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(`${path.to.uom(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Unit of Measure</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              // Each is built in; the database refuses to delete it.
              disabled={
                !permissions.can("delete", "parts") ||
                row.code === EACH_UNIT_OF_MEASURE_CODE
              }
              onClick={() => {
                navigate(`${path.to.deleteUom(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Unit of Measure</Trans>
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
        importCSV={[
          {
            table: "unitOfMeasure" as const,
            label: t`Unit of Measures`
          }
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Unit of Measure`}
              to={`${path.to.newUom}?${params.toString()}`}
            />
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Unit of Measures`}
        withSelectableRows
      />
    );
  }
);

UnitOfMeasuresTable.displayName = "UnitOfMeasuresTable";
export default UnitOfMeasuresTable;
