import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { NoQuoteReason } from "../../types";

type NoQuoteReasonsTableProps = {
  data: NoQuoteReason[];
  count: number;
};

const NoQuoteReasonsTable = memo(
  ({ data, count }: NoQuoteReasonsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<NoQuoteReason>("noQuoteReason");
    const columns = useMemo<ColumnDef<NoQuoteReason>[]>(() => {
      const defaultColumns: ColumnDef<NoQuoteReason>[] = [
        {
          accessorKey: "name",
          header: "Reason",
          cell: ({ row }) => (
            <Enumerable
              value={row.original.name}
              onClick={() => navigate(row.original.id)}
              className="cursor-pointer"
            />
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [navigate, customColumns]);

    const renderContextMenu = useCallback(
      (row: NoQuoteReason) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.noQuoteReason(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Reason
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteNoQuoteReason(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Reason
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<NoQuoteReason>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label="Reason"
              to={`${path.to.newNoQuoteReason}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Reasons"
      />
    );
  }
);

NoQuoteReasonsTable.displayName = "NoQuoteReasonsTable";
export default NoQuoteReasonsTable;
