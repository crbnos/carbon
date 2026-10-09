// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Checkbox,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBriefcaseBusiness, LuCheck, LuPencil, LuText } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { LaborCategory } from "../../types";

type LaborCategoriesTableProps = {
  data: LaborCategory[];
  count: number;
};

const LaborCategoriesTable = memo(
  ({ data, count }: LaborCategoriesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<LaborCategory>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.laborCategory(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuBriefcaseBusiness /> }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="line-clamp-1">
              {row.original.description ?? ""}
            </span>
          ),
          meta: { icon: <LuText /> }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: { icon: <LuCheck /> }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: LaborCategory) => (
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          disabled={!permissions.can("update", "projects")}
          onClick={() => navigate(path.to.laborCategory(row.id))}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Labor Category</Trans>
        </MenuItem>
      ),
      [navigate, permissions]
    );

    return (
      <Table<LaborCategory>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "projects") && (
            <New label={t`Labor Category`} to={path.to.newLaborCategory} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Labor Categories`}
      />
    );
  }
);

LaborCategoriesTable.displayName = "LaborCategoriesTable";
export default LaborCategoriesTable;
