import { MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuPencil,
  LuRepeat,
  LuToggleLeft,
  LuToggleRight
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { recurringJournalFrequencies } from "../../accounting.models";
import type { RecurringJournalTemplateListItem } from "../../types";

type RecurringJournalsTableProps = {
  data: RecurringJournalTemplateListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const RecurringJournalsTable = memo(
  ({ data, count, primaryAction }: RecurringJournalsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<RecurringJournalTemplateListItem>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={`${row.original.id}?${params.toString()}`}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "frequency",
          header: t`Frequency`,
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: recurringJournalFrequencies.map((v) => ({
                label: <Enumerable value={v} />,
                value: v
              }))
            },
            icon: <LuRepeat />
          }
        },
        {
          accessorKey: "nextRunDate",
          header: t`Next Run Date`,
          cell: ({ row }) =>
            row.original.nextRunDate
              ? formatDate(row.original.nextRunDate)
              : "—",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "endDate",
          header: t`End Date`,
          cell: ({ row }) =>
            row.original.endDate ? formatDate(row.original.endDate) : "—",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: ({ row }) =>
            row.original.active ? (
              <Status color="green">
                <Trans>Active</Trans>
              </Status>
            ) : (
              <Status color="gray">
                <Trans>Inactive</Trans>
              </Status>
            ),
          meta: {
            icon: <LuToggleRight />
          }
        }
      ],
      [params, t]
    );

    const renderContextMenu = useCallback(
      (row: RecurringJournalTemplateListItem) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "accounting")}
              onClick={() => {
                navigate(
                  `${path.to.recurringJournal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "accounting") || !row.active}
              onClick={() => {
                navigate(
                  `${path.to.recurringJournalDelete(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuToggleLeft />} />
              <Trans>Deactivate</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<RecurringJournalTemplateListItem>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        renderContextMenu={renderContextMenu}
        title={t`Recurring Journals`}
      />
    );
  }
);

RecurringJournalsTable.displayName = "RecurringJournalsTable";
export default RecurringJournalsTable;
