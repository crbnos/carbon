// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsFillPenFill } from "react-icons/bs";
import { IoMdTrash } from "react-icons/io";
import { LuCalendar, LuCalendarDays, LuCalendarRange } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Holiday } from "../../types";

type HolidaysTableProps = {
  data: Holiday[];
  count: number;
  infinite: InfiniteOptions;
  years: number[];
};

const HolidaysTable = memo((props: HolidaysTableProps) => {
  const { data, count, infinite, years } = props;
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const customColumns = useCustomColumns<(typeof data)[number]>("holiday");

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Holiday`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>{row.original.name}</Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "year",
        header: t`Year`,
        cell: (item) => (
          <Enumerable value={item.getValue<number>().toString()} />
        ),
        meta: {
          icon: <LuCalendarRange />,
          filter: {
            type: "static",
            options: years.map((year) => ({
              label: <Enumerable value={year.toString()} />,
              value: year.toString()
            }))
          }
        }
      },
      {
        accessorKey: "date",
        header: t`Date`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: {
          mobile: "P2",
          filter: {
            type: "dateRange"
          },
          icon: <LuCalendarDays />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, years, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(`${path.to.holiday(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<BsFillPenFill />} />
            <Trans>Edit Holiday</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            disabled={!permissions.can("delete", "people")}
            destructive
            onClick={() => {
              navigate(`${path.to.deleteHoliday(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<IoMdTrash />} />
            <Trans>Delete Holiday</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      infinite={infinite}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label={t`Holiday`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Holidays`}
    />
  );
});

HolidaysTable.displayName = "HolidaysTable";
export default HolidaysTable;
