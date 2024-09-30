import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Currency } from "~/modules/accounting";
import { path } from "~/utils/path";

type CurrenciesTableProps = {
  data: Currency[];
  count: number;
};

const CurrenciesTable = memo(({ data, count }: CurrenciesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<Currency>("currency");

  const columns = useMemo<ColumnDef<Currency>[]>(() => {
    const defaultColumns: ColumnDef<Currency>[] = [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Hyperlink to={row.original.id as string}>
            {row.original.name}
          </Hyperlink>
        ),
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: (item) => item.getValue(),
      },
      {
        header: "Symbol",
        cell: ({ row }) => row.original.symbol,
      },
      {
        accessorKey: "exchangeRate",
        header: "Exchange Rate",
        cell: (item) => item.getValue(),
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns]);

  const renderContextMenu = useCallback(
    (row: Currency) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.currency(row.id as string)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Currency
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Currency>
      data={data}
      columns={columns}
      count={count}
      renderContextMenu={renderContextMenu}
    />
  );
});

CurrenciesTable.displayName = "CurrenciesTable";
export default CurrenciesTable;
