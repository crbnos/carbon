import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
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
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<NoQuoteReason>("noQuoteReason");
    const columns = useMemo<ColumnDef<NoQuoteReason>[]>(() => {
      const defaultColumns: ColumnDef<NoQuoteReason>[] = [
        {
          accessorKey: "name",
          header: t`Reason`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, t]);

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
              <Trans>Edit Reason</Trans>
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
              <Trans>Delete Reason</Trans>
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
              label={t`Reason`}
              to={`${path.to.newNoQuoteReason}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Reasons`}
      />
    );
  }
);

NoQuoteReasonsTable.displayName = "NoQuoteReasonsTable";
export default NoQuoteReasonsTable;
