import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuListChecks, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ChangeNoticeRequiredAction } from "../../types";

type ChangeNoticeRequiredActionsTableProps = {
  data: ChangeNoticeRequiredAction[];
  count: number;
};

const ChangeNoticeRequiredActionsTable = memo(
  ({ data, count }: ChangeNoticeRequiredActionsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<ChangeNoticeRequiredAction>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Action`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuListChecks />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: ({ row }) => <Checkbox checked={row.original.active} />
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: ChangeNoticeRequiredAction) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.changeNoticeRequiredAction(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Action`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.deleteChangeNoticeRequiredAction(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Action`}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    return (
      <Table<ChangeNoticeRequiredAction>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Action`}
              to={`${path.to.newChangeNoticeRequiredAction}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Change Notice Actions`}
      />
    );
  }
);

ChangeNoticeRequiredActionsTable.displayName =
  "ChangeNoticeRequiredActionsTable";
export default ChangeNoticeRequiredActionsTable;
