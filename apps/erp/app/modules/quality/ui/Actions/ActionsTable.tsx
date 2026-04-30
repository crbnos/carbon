import { Badge, MenuIcon, MenuItem, Status } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleGauge,
  LuFileText,
  LuOctagonX,
  LuPencil,
  LuSquareStack,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useItems } from "~/stores";
import { usePeople } from "~/stores/people";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { nonConformanceTaskStatus } from "../../quality.models";
import type { QualityAction } from "../../types";
import IssueStatus from "../Issue/IssueStatus";

type ActionsTableProps = {
  data: QualityAction[];
  issueTypes: ListItem[];
  requiredActions: ListItem[];
  count: number;
};

const ActionsTable = memo(
  ({ data, issueTypes, requiredActions, count }: ActionsTableProps) => {
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const [people] = usePeople();
    const [items] = useItems();

    const columns = useMemo<ColumnDef<QualityAction>[]>(() => {
      const defaultColumns: ColumnDef<QualityAction>[] = [
        {
          accessorKey: "readableNonConformanceId",
          header: t`Issue`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.issueActions(row.original.nonConformanceId!)}
            >
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  {row.original.readableNonConformanceId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.original.nonConformanceName}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "actionType",
          header: t`Action Type`,
          cell: ({ row }) => <Enumerable value={row.original.actionType} />,
          meta: {
            icon: <LuFileText />,
            filter: {
              type: "static",
              options: requiredActions.map((action) => ({
                label: action.name,
                value: action.name
              }))
            }
          }
        },
        {
          accessorKey: "status",
          header: t`Action Status`,
          cell: ({ row }) => <ActionStatus status={row.original.status} />,
          meta: {
            icon: <LuCircleGauge />,
            filter: {
              type: "static",
              options: nonConformanceTaskStatus.map((status) => ({
                label: <ActionStatus status={status} />,
                value: status
              }))
            }
          }
        },
        {
          accessorKey: "assignee",
          header: t`Assignee`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },
        {
          id: "items",
          header: t`Items`,
          cell: ({ row }) => (
            <span className="flex gap-2 items-center flex-wrap py-2">
              {((row.original.items ?? []) as Array<string>).map((i) => {
                const item = items.find((x) => x.id === i);
                if (!item) return null;
                return (
                  <Badge variant="outline" key={item?.id}>
                    {item?.readableIdWithRevision}
                  </Badge>
                );
              })}
            </span>
          ),
          meta: {
            icon: <LuSquareStack />,
            filter: {
              type: "static",
              options: items.map((item) => ({
                value: item.id,
                label: (
                  <Badge variant="outline">{item.readableIdWithRevision}</Badge>
                )
              })),
              isArray: true
            }
          }
        },
        {
          accessorKey: "dueDate",
          header: t`Due Date`,
          cell: ({ row }) => {
            const isOverdue =
              // @ts-ignore
              !["Completed", "Skipped"].includes(row.original.status) &&
              row.original.nonConformanceStatus !== "Closed" &&
              row.original.dueDate &&
              new Date(row.original.dueDate) < new Date();
            return (
              <span className={isOverdue ? "text-red-500" : ""}>
                {formatDate(row.original.dueDate)}
              </span>
            );
          },
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "nonConformanceStatus",
          header: t`Issue Status`,
          cell: ({ row }) =>
            row.original.nonConformanceStatus && (
              <IssueStatus status={row.original.nonConformanceStatus as any} />
            ),
          meta: {
            icon: <LuOctagonX />
          }
        },
        {
          accessorKey: "nonConformanceTypeName",
          header: t`Issue Type`,
          cell: ({ row }) => (
            <Enumerable value={row.original.nonConformanceTypeName} />
          ),
          meta: {
            icon: <LuOctagonX />,
            filter: {
              type: "static",
              options: issueTypes.map((type) => ({
                label: type.name,
                value: type.name
              }))
            }
          }
        },

        {
          accessorKey: "dueDate",
          header: t`Due Date`,
          cell: ({ row }) => formatDate(row.original.dueDate),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "completedDate",
          header: t`Completed Date`,
          cell: ({ row }) => formatDate(row.original.completedDate),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created`,
          cell: ({ row }) => formatDate(row.original.createdAt),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return defaultColumns;
    }, [requiredActions, people, items, issueTypes, t]);

    const renderContextMenu = useCallback(
      (row: QualityAction) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.issue(row.nonConformanceId!)}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>View Issue</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, permissions]
    );

    return (
      <Table<QualityAction>
        data={data}
        columns={columns}
        count={count}
        renderContextMenu={renderContextMenu}
        title={t`Actions`}
        table="nonConformanceActionTask"
        withSavedView
      />
    );
  }
);

ActionsTable.displayName = "ActionsTable";
export default ActionsTable;

function ActionStatus({ status }: { status: QualityAction["status"] }) {
  switch (status) {
    case "Pending":
      return (
        <Status color="yellow">
          <Trans>Pending</Trans>
        </Status>
      );
    case "In Progress":
      return (
        <Status color="green">
          <Trans>In Progress</Trans>
        </Status>
      );
    case "Completed":
      return (
        <Status color="blue">
          <Trans>Completed</Trans>
        </Status>
      );
    case "Skipped":
      return (
        <Status color="gray">
          <Trans>Skipped</Trans>
        </Status>
      );
  }
}
