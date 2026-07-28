import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuGitPullRequestArrow, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ChangeNoticeType } from "../../types";

type ChangeNoticeTypesTableProps = {
  data: ChangeNoticeType[];
  count: number;
};

const ChangeNoticeTypesTable = memo(
  ({ data, count }: ChangeNoticeTypesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<ChangeNoticeType>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Type`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuGitPullRequestArrow />
          }
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: ChangeNoticeType) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.changeNoticeType(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Type`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.deleteChangeNoticeType(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Type`}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    return (
      <Table<ChangeNoticeType>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Type`}
              to={`${path.to.newChangeNoticeType}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Change Notice Types`}
      />
    );
  }
);

ChangeNoticeTypesTable.displayName = "ChangeNoticeTypesTable";
export default ChangeNoticeTypesTable;
