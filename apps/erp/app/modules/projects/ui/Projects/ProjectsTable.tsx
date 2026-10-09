// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuFolderKanban, LuLetterText, LuPencil } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectListItem } from "../../types";

type ProjectsTableProps = {
  data: ProjectListItem[];
  count: number;
};

const ProjectsTable = memo(({ data, count }: ProjectsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<ProjectListItem>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.projectElements(row.original.id)}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuFolderKanban />
        }
      },
      {
        accessorKey: "description",
        header: t`Description`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuLetterText />
        }
      }
    ];
  }, [t]);

  const renderContextMenu = useCallback(
    (row: ProjectListItem) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "projects")}
            onClick={() => {
              navigate(path.to.projectDetails(row.id));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Project</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, permissions]
  );

  return (
    <Table<ProjectListItem>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "projects") && (
          <New
            label={t`Project`}
            to={`${path.to.newProject}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Projects`}
    />
  );
});

ProjectsTable.displayName = "ProjectsTable";
export default ProjectsTable;
