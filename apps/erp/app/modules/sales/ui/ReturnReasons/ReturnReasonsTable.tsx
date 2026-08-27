import type { Database } from "@carbon/database";
import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuCircleSlash, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";

type ReturnReason = Database["public"]["Tables"]["returnReason"]["Row"];

type ReturnReasonsTableProps = {
  data: ReturnReason[];
  count: number;
};

const ReturnReasonsTable = memo(({ data, count }: ReturnReasonsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<ReturnReason>("returnReason");
  const columns = useMemo<ColumnDef<ReturnReason>[]>(() => {
    const defaultColumns: ColumnDef<ReturnReason>[] = [
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
      },
      {
        accessorKey: "inventoryValueZero",
        header: t`Zero Inventory Value`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              {
                value: "true",
                label: t`Yes`
              },
              {
                value: "false",
                label: t`No`
              }
            ]
          },
          icon: <LuCircleSlash />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, t]);

  const renderContextMenu = useCallback(
    (row: ReturnReason) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.returnReason(row.id)}?${params.toString()}`);
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
                `${path.to.deleteReturnReason(row.id)}?${params.toString()}`
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
    <Table<ReturnReason>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t`Reason`}
            to={`${path.to.newReturnReason}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Return Reasons`}
    />
  );
});

ReturnReasonsTable.displayName = "ReturnReasonsTable";
export default ReturnReasonsTable;
