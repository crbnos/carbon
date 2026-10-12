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
import {
  LuCheck,
  LuFolderKanban,
  LuGroup,
  LuListOrdered,
  LuMapPin,
  LuPackageOpen,
  LuPencil,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  planningGroupExcessRules,
  planningGroupPriorityRules
} from "../../projects.models";
import type { PlanningGroup } from "../../types";
import { usePlanningGroupExcessRuleLabels } from "./usePlanningGroupLabels";

type PlanningGroupsTableProps = {
  data: PlanningGroup[];
  count: number;
};

function memberCount(group: PlanningGroup) {
  return group.members?.[0]?.count ?? 0;
}

const PlanningGroupsTable = memo(
  ({ data, count }: PlanningGroupsTableProps) => {
    const { t } = useLingui();
    const excessRuleLabels = usePlanningGroupExcessRuleLabels();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<PlanningGroup>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.planningGroup(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuGroup /> }
        },
        {
          id: "location",
          header: t`Location`,
          cell: ({ row }) => (
            <span className="line-clamp-1">
              {row.original.location?.name ?? ""}
            </span>
          ),
          meta: {
            icon: <LuMapPin />,
            exportValue: (row: PlanningGroup) => row.location?.name ?? ""
          }
        },
        {
          id: "members",
          header: t`Members`,
          cell: ({ row }) => (
            <span className="tabular-nums">{memberCount(row.original)}</span>
          ),
          meta: {
            icon: <LuUsers />,
            exportValue: (row: PlanningGroup) => memberCount(row)
          }
        },
        {
          accessorKey: "priorityRule",
          header: t`Priority Rule`,
          cell: ({ row }) => <Enumerable value={row.original.priorityRule} />,
          meta: {
            filter: {
              type: "static",
              options: planningGroupPriorityRules.map((rule) => ({
                value: rule,
                label: <Enumerable value={rule} />
              }))
            },
            icon: <LuListOrdered />
          }
        },
        {
          accessorKey: "excessRule",
          header: t`Excess Rule`,
          cell: ({ row }) => (
            <Enumerable value={excessRuleLabels[row.original.excessRule]} />
          ),
          meta: {
            filter: {
              type: "static",
              options: planningGroupExcessRules.map((rule) => ({
                value: rule,
                label: <Enumerable value={excessRuleLabels[rule]} />
              }))
            },
            icon: <LuPackageOpen />
          }
        },
        {
          id: "exceptionProject",
          header: t`Exception Project`,
          cell: ({ row }) =>
            row.original.exceptionProject ? (
              <Hyperlink
                to={path.to.projectDetails(row.original.exceptionProject.id)}
              >
                <span className="whitespace-nowrap">
                  {row.original.exceptionProject.identifier}
                </span>
              </Hyperlink>
            ) : null,
          meta: {
            icon: <LuFolderKanban />,
            exportValue: (row: PlanningGroup) =>
              row.exceptionProject?.identifier ?? ""
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: { icon: <LuCheck /> }
        }
      ],
      [t, excessRuleLabels]
    );

    const renderContextMenu = useCallback(
      (row: PlanningGroup) => (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "projects")}
            onClick={() => navigate(path.to.planningGroup(row.id))}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Planning Group</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "projects")}
            onClick={() => navigate(path.to.deletePlanningGroup(row.id))}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Planning Group</Trans>
          </MenuItem>
        </>
      ),
      [navigate, permissions]
    );

    return (
      <Table<PlanningGroup>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "projects") && (
            <New label={t`Planning Group`} to={path.to.newPlanningGroup} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Planning Groups`}
      />
    );
  }
);

PlanningGroupsTable.displayName = "PlanningGroupsTable";
export default PlanningGroupsTable;
