import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuFolderKanban,
  LuLetterText,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { Project } from "../../types";

type ProjectsTableProps = {
  data: Project[];
  count: number;
};

const ProjectsTable = memo(({ data, count }: ProjectsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<Project>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={`${row.original.id}?${params.toString()}`}>
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
  }, [params, t]);

  const renderContextMenu = useCallback(
    (row: Project) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(`${path.to.project(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Project</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            onClick={() => {
              navigate(`${path.to.deleteProject(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Project</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Project>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Project`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Projects`}
    />
  );
});

ProjectsTable.displayName = "ProjectsTable";
export default ProjectsTable;
