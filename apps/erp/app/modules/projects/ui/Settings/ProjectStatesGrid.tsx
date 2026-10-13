// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  ActionMenu,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MenuIcon,
  MenuItem,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { LuCheck, LuTrash } from "react-icons/lu";
import {
  EditableList,
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
import Grid from "~/components/Grid";
import { useCellSave } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectStateGroup } from "../../projects.models";
import { projectStateGroups } from "../../projects.models";
import type { ProjectState } from "../../types";
import { sortStates } from "../Elements/ElementProperties";
import { StateIcon } from "../Project/StateIcon";
import { ColorCell, nextName } from "./ColorCell";

/**
 * The company's project states, in board order: name, group and colour edit
 * in the grid; the row menu makes a state its group's default or deletes it.
 * Every project and service order uses these states.
 */
export function ProjectStatesGrid({ states }: { states: ProjectState[] }) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");
  const save = useCellSave();
  const action = path.to.projectsSettings;
  const fetcher = useAction<{ message?: string }>({
    onSuccess: (data) => data.message && toast.success(data.message),
    onError: (data) => toast.error(data.message ?? t`Failed to save`)
  });

  const groupLabels = useMemo<Record<ProjectStateGroup, string>>(
    () => ({
      Backlog: t`Backlog`,
      Unstarted: t`Unstarted`,
      Started: t`Started`,
      Completed: t`Completed`,
      Cancelled: t`Cancelled`
    }),
    [t]
  );

  const rows = useMemo(() => sortStates(states), [states]);

  const saveRow = useCallback(
    (row: ProjectState, changes: Partial<ProjectState>) => {
      const next = { ...row, ...changes };
      return save(action, {
        intent: "upsertState",
        id: next.id,
        name: next.name,
        group: next.group,
        color: next.color
      });
    },
    [action, save]
  );

  const editableComponents = useStableEditableComponents(
    (latest) => ({
      name: EditableText<ProjectState>((key, value, row) =>
        latest.current.saveRow(row, { [key]: value })
      ),
      group: EditableList<ProjectState>(
        (key, value, row) =>
          latest.current.saveRow(row, { [key]: value as ProjectStateGroup }),
        projectStateGroups.map((group) => ({
          value: group,
          label: groupLabels[group]
        }))
      )
    }),
    { saveRow }
  );

  const columns = useMemo<ColumnDef<ProjectState>[]>(
    () => [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <StateIcon group={row.original.group} color={row.original.color} />
            {row.original.name}
            {row.original.isDefault && (
              <span className="text-xs text-muted-foreground">
                <Trans>Default</Trans>
              </span>
            )}
          </span>
        )
      },
      {
        accessorKey: "group",
        header: t`Group`,
        cell: ({ row }) => groupLabels[row.original.group]
      },
      {
        accessorKey: "color",
        header: t`Colour`,
        cell: ({ row }) => (
          <ColorCell
            key={`${row.original.id}:${row.original.color}`}
            value={row.original.color}
            isDisabled={!canEdit}
            onSave={(color) => saveRow(row.original, { color })}
          />
        )
      },
      {
        id: "menu",
        header: () => <span className="sr-only">{t`Actions`}</span>,
        size: 48,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ActionMenu>
              <MenuItem
                disabled={!canEdit || row.original.isDefault}
                onClick={() =>
                  fetcher.submit(
                    { intent: "setDefaultState", id: row.original.id },
                    { method: "post", action }
                  )
                }
              >
                <MenuIcon icon={<LuCheck />} />
                <Trans>Make default</Trans>
              </MenuItem>
              <MenuItem
                destructive
                disabled={!canEdit}
                onClick={() =>
                  fetcher.submit(
                    { intent: "deleteState", id: row.original.id },
                    { method: "post", action }
                  )
                }
              >
                <MenuIcon icon={<LuTrash />} />
                <Trans>Delete</Trans>
              </MenuItem>
            </ActionMenu>
          </div>
        )
      }
    ],
    [t, groupLabels, canEdit, saveRow, fetcher, action]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>States</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            The states every project and service order uses. The default of each
            group is the state a new element takes.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Grid<ProjectState>
          data={rows}
          columns={columns}
          canEdit={canEdit}
          editableComponents={editableComponents}
          withSimpleSorting={false}
          onNewRow={
            canEdit
              ? () =>
                  fetcher.submit(
                    {
                      intent: "upsertState",
                      name: nextName(
                        t`New state`,
                        states.map((s) => s.name)
                      ),
                      group: "Unstarted",
                      color: "#60646C"
                    },
                    { method: "post", action }
                  )
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
