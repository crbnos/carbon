import { Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsFillPenFill } from "react-icons/bs";
import { IoMdTrash } from "react-icons/io";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Holiday } from "../../types";

type HolidaysTableProps = {
  data: Holiday[];
  count: number;
  years: number[];
};

const HolidaysTable = memo(({ data, count, years }: HolidaysTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const customColumns = useCustomColumns<(typeof data)[number]>("holiday");

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: "Holiday",
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>{row.original.name}</Hyperlink>
        ),
      },
      {
        accessorKey: "year",
        header: "Year",
        cell: (item) => (
          <Enumerable value={item.getValue<number>().toString()} />
        ),
        meta: {
          filter: {
            type: "static",
            options: years.map((year) => ({
              label: <Enumerable value={year.toString()} />,
              value: year.toString(),
            })),
          },
        },
      },
      {
        accessorKey: "date",
        header: "Date",
        cell: (item) => item.getValue<string>(),
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, years]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.holiday(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<BsFillPenFill />} />
            Edit Holiday
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "people")}
            onClick={() => {
              navigate(`${path.to.deleteHoliday(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<IoMdTrash />} />
            Delete Holiday
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label="Holiday" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

HolidaysTable.displayName = "HolidaysTable";
export default HolidaysTable;
