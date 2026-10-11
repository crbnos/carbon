// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Checkbox,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuChartPie,
  LuCheck,
  LuCirclePlus,
  LuFolderKanban,
  LuHandCoins,
  LuPencil,
  LuReceipt,
  LuStar,
  LuUser,
  LuWallet
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { projectCostTreatments, projectStatuses } from "../../projects.models";
import type { ProjectListItem } from "../../types";
import ProjectForm from "./ProjectForm";
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
  const newProjectDisclosure = useDisclosure();
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter();
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<ProjectsTableRow>[]>(() => {
    return [
      {
        accessorKey: "identifier",
        header: t`Identifier`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.projectElements(row.original.id)}>
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
        accessorKey: "endDate",
        header: t`End Date`,
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
  }, [currencyFormatter, formatDate, people, t]);

  const renderContextMenu = useCallback(
    (row: ProjectsTableRow) => (
      <>
        <MenuItem
          onClick={() => {
            navigate(path.to.projectElements(row.id));
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
    <>
      <Table<ProjectsTableRow>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["identifier"]
        }}
        primaryAction={
          permissions.can("create", "projects") && (
            <Button
              leftIcon={<LuCirclePlus />}
              onClick={newProjectDisclosure.onOpen}
            >
              <Trans>New Project</Trans>
            </Button>
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Projects`}
        table="project"
        withSavedView
      />
      {newProjectDisclosure.isOpen && (
        <ProjectForm
          initialValues={{ name: "", costTreatment: "Statistical" }}
          onClose={newProjectDisclosure.onClose}
        />
      )}
    </>
  );
});

ProjectsTable.displayName = "ProjectsTable";
export default ProjectsTable;
