// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Checkbox,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Progress
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuChartPie,
  LuCheck,
  LuFolderKanban,
  LuGauge,
  LuHandCoins,
  LuPencil,
  LuReceipt,
  LuStar,
  LuUser,
  LuWallet
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Empty, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { projectCostTreatments, projectStatuses } from "../../projects.models";
import type { ProjectListItem } from "../../types";
import ProjectStatus from "./ProjectStatus";

export type ProjectsTableRow = ProjectListItem & {
  budget: number;
  committed: number;
  actual: number;
};

type ProjectsTableProps = {
  data: ProjectsTableRow[];
  count: number;
};

const ProjectsTable = memo(({ data, count }: ProjectsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const [people] = usePeople();
  const [params] = useUrlParams();
  const isFiltered = params.has("filter") || params.has("search");

  const columns = useMemo<ColumnDef<ProjectsTableRow>[]>(() => {
    return [
      {
        accessorKey: "identifier",
        header: t`Identifier`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.project(row.original.id)}>
            <span className="whitespace-nowrap">{row.original.identifier}</span>
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <span className="line-clamp-1">{row.original.name}</span>
        ),
        meta: {
          mobile: "P3",
          icon: <LuFolderKanban />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ProjectStatus status={row.original.status} />,
        meta: {
          filter: {
            type: "static",
            options: projectStatuses.map((status) => ({
              value: status,
              label: <ProjectStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          mobile: "P2",
          icon: <LuStar />
        }
      },
      {
        accessorKey: "costTreatment",
        header: t`Treatment`,
        cell: ({ row }) => <Enumerable value={row.original.costTreatment} />,
        meta: {
          filter: {
            type: "static",
            options: projectCostTreatments.map((treatment) => ({
              value: treatment,
              label: <Enumerable value={treatment} />
            }))
          },
          pluralHeader: t`Treatments`,
          icon: <LuChartPie />
        }
      },
      {
        accessorKey: "ownerId",
        header: t`Owner`,
        cell: ({ row }) => <EmployeeAvatar employeeId={row.original.ownerId} />,
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />,
          exportValue: (row: ProjectsTableRow) =>
            people.find((employee) => employee.id === row.ownerId)?.name ??
            row.ownerId
        }
      },
      {
        accessorKey: "endDate",
        header: t`Due`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        // Actual cost against budget: the one figure a manager scans for.
        id: "budgetUsed",
        header: t`Budget used`,
        cell: ({ row }) => {
          const { actual, budget } = row.original;
          if (!budget) {
            return <span className="text-muted-foreground">—</span>;
          }
          const used = actual / budget;
          return (
            <div className="flex w-40 items-center gap-2">
              <Progress
                value={Math.min(used * 100, 100)}
                aria-label={t`Budget used`}
                className="h-1.5 min-w-0 flex-1"
                indicatorClassName={
                  used > 1 ? "bg-red-500" : "bg-foreground/70"
                }
              />
              <span
                className={
                  used > 1
                    ? "w-11 shrink-0 text-right text-xs tabular-nums text-red-500"
                    : "w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                }
              >
                {percentFormatter.format(used)}
              </span>
            </div>
          );
        },
        meta: {
          icon: <LuGauge />,
          exportValue: (row: ProjectsTableRow) =>
            row.budget ? row.actual / row.budget : null
        }
      },
      {
        id: "budget",
        header: t`Budget`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(row.original.budget)}
          </span>
        ),
        meta: {
          icon: <LuWallet />,
          exportValue: (row: ProjectsTableRow) => row.budget
        }
      },
      {
        id: "actual",
        header: t`Actual`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(row.original.actual)}
          </span>
        ),
        meta: {
          icon: <LuReceipt />,
          exportValue: (row: ProjectsTableRow) => row.actual
        }
      },
      {
        id: "committed",
        header: t`Committed`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(row.original.committed)}
          </span>
        ),
        meta: {
          icon: <LuHandCoins />,
          exportValue: (row: ProjectsTableRow) => row.committed
        }
      },
      {
        accessorKey: "startDate",
        header: t`Start Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          icon: <LuCheck />
        }
      }
    ];
  }, [currencyFormatter, formatDate, people, percentFormatter, t]);

  const renderContextMenu = useCallback(
    (row: ProjectsTableRow) => (
      <>
        <MenuItem
          onClick={() => {
            navigate(path.to.project(row.id));
          }}
        >
          <MenuIcon icon={<LuFolderKanban />} />
          <Trans>Open Project</Trans>
        </MenuItem>
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
    ),
    [navigate, permissions]
  );

  return (
    <Table<ProjectsTableRow>
      data={data}
      columns={columns}
      count={count}
      defaultColumnPinning={{
        left: ["identifier"]
      }}
      // The list shows what a manager scans; the rest stays one click away
      // in the columns menu, and in every filter and the CSV export.
      defaultColumnVisibility={{
        costTreatment: false,
        budget: false,
        actual: false,
        committed: false,
        startDate: false,
        active: false
      }}
      primaryAction={
        permissions.can("create", "projects") && (
          <New label={t`Project`} to={path.to.newProject} />
        )
      }
      emptyState={isFiltered ? undefined : <Empty title={t`No projects yet`} />}
      renderContextMenu={renderContextMenu}
      title={t`Projects`}
      table="project"
      withSavedView
    />
  );
});

ProjectsTable.displayName = "ProjectsTable";
export default ProjectsTable;
