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
import { LuTrash } from "react-icons/lu";
import {
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
import Grid from "~/components/Grid";
import { useCellSave } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectLabel } from "../../types";
import { ColorCell, nextName } from "./ColorCell";

/**
 * The company's project labels: name and colour edit in the grid; the row
 * menu deletes a label (its elements lose it). Every project uses these.
 */
export function ProjectLabelsGrid({ labels }: { labels: ProjectLabel[] }) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");
  const save = useCellSave();
  const action = path.to.projectsSettings;
  const fetcher = useAction<{ message?: string }>({
    onSuccess: (data) => data.message && toast.success(data.message),
    onError: (data) => toast.error(data.message ?? t`Failed to save`)
  });

  const saveRow = useCallback(
    (row: ProjectLabel, changes: Partial<ProjectLabel>) => {
      const next = { ...row, ...changes };
      return save(action, {
        intent: "upsertLabel",
        id: next.id,
        name: next.name,
        color: next.color
      });
    },
    [action, save]
  );

  const editableComponents = useStableEditableComponents(
    (latest) => ({
      name: EditableText<ProjectLabel>((key, value, row) =>
        latest.current.saveRow(row, { [key]: value })
      )
    }),
    { saveRow }
  );

  const columns = useMemo<ColumnDef<ProjectLabel>[]>(
    () => [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.original.color }}
            />
            {row.original.name}
          </span>
        )
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
                destructive
                disabled={!canEdit}
                onClick={() =>
                  fetcher.submit(
                    { intent: "deleteLabel", id: row.original.id },
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
    [t, canEdit, saveRow, fetcher, action]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Labels</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>The labels every project can put on its elements.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Grid<ProjectLabel>
          data={labels}
          columns={columns}
          canEdit={canEdit}
          editableComponents={editableComponents}
          withSimpleSorting={false}
          onNewRow={
            canEdit
              ? () =>
                  fetcher.submit(
                    {
                      intent: "upsertLabel",
                      name: nextName(
                        t`New label`,
                        labels.map((l) => l.name)
                      ),
                      color: "#3B82F6"
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
