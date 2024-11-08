import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { ScrapReason } from "../../types";

type ScrapReasonsTableProps = {
  data: ScrapReason[];
  count: number;
};

const ScrapReasonsTable = memo(({ data, count }: ScrapReasonsTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<ScrapReason>("scrapReason");
  const columns = useMemo<ColumnDef<ScrapReason>[]>(() => {
    const defaultColumns: ColumnDef<ScrapReason>[] = [
      {
        accessorKey: "name",
        header: "Scrap Reason",
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id)}
            className="cursor-pointer"
          />
        ),
        meta: {
          icon: <LuTrash />,
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [navigate, customColumns]);

  const renderContextMenu = useCallback(
    (row: ScrapReason) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.scrapReason(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Scrap Reason
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteScrapReason(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Scrap Reason
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<ScrapReason>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label="Scrap Reason"
            to={`${path.to.newScrapReason}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

ScrapReasonsTable.displayName = "ScrapReasonsTable";
export default ScrapReasonsTable;
