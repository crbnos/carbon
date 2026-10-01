// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuOctagonX, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { IssueType } from "../../types";

type IssueTypesTableProps = {
  data: IssueType[];
  count: number;
};

const IssueTypesTable = memo(({ data, count }: IssueTypesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<IssueType>("nonConformanceType");

  const columns = useMemo<ColumnDef<IssueType>[]>(() => {
    const defaultColumns: ColumnDef<IssueType>[] = [
      {
        accessorKey: "name",
        header: t`Issue Type`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: {
          icon: <LuOctagonX />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, t]);

  const renderContextMenu = useCallback(
    (row: IssueType) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.issueType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Type
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteIssueType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Type
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<IssueType>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "quality") && (
          <New
            label={t`Issue Type`}
            to={`${path.to.newIssueType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Issue Types`}
    />
  );
});

IssueTypesTable.displayName = "IssueTypesTable";
export default IssueTypesTable;
