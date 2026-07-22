import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookmark,
  LuCalendar,
  LuCircleDollarSign,
  LuFileText,
  LuPencil,
  LuStar,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { JournalEntrySourceTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { usePeople } from "~/stores/people";
import { path } from "~/utils/path";
import {
  journalEntrySourceTypes,
  journalEntryStatuses
} from "../../accounting.models";
import type { JournalEntryListItem } from "../../types";
import JournalEntryStatus from "./JournalEntryStatus";

type JournalEntriesTableProps = {
  data: JournalEntryListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const defaultColumnVisibility = {
  sourceType: false,
  createdBy: false,
  createdAt: false,
  updatedBy: false,
  updatedAt: false
};

const JournalEntriesTable = memo(
  ({ data, count, primaryAction }: JournalEntriesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const { company } = useUser();
    const [people] = usePeople();
    const currencyFormatter = useCurrencyFormatter({
      currency: company.baseCurrencyCode
    });
    const [selectedEntry, setSelectedEntry] =
      useState<JournalEntryListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<JournalEntryListItem>[]>(() => {
      const defaultColumns: ColumnDef<JournalEntryListItem>[] = [
        {
          accessorKey: "journalEntryId",
          header: t`Journal Entry`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.journalEntryDetails(row.original.id?.toString()!)}
            >
              {row.original.journalEntryId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookmark />
          }
        },
        {
          accessorKey: "postingDate",
          header: t`Date`,
          cell: ({ row }) => formatDate(row.original.postingDate),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <HStack className="py-1" spacing={2}>
              <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center flex-shrink-0 p-1">
                <JournalEntrySourceTypeIcon
                  sourceType={row.original.sourceType ?? "Manual"}
                  className="w-4 h-4 text-[#AAAAAA] dark:text-[#444]"
                />
              </div>

              <div className="flex flex-col max-w-[300px] truncate">
                <div className="text-sm line-clamp-1">
                  {row.original.description || "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.original.sourceType || "—"}
                </div>
              </div>
            </HStack>
          ),
          meta: {
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "sourceType",
          header: t`Source`,
          cell: ({ row }) => <Enumerable value={row.original.sourceType} />,
          meta: {
            icon: <LuTag />,
            filter: {
              type: "static",
              options: journalEntrySourceTypes.map((v) => ({
                label: <Enumerable value={v} />,
                value: v
              }))
            }
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <JournalEntryStatus
              status={
                row.original.status as (typeof journalEntryStatuses)[number]
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: journalEntryStatuses.map((v) => ({
                label: <JournalEntryStatus status={v} />,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "totalDebits",
          header: t`Debits`,
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.totalDebits)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "totalCredits",
          header: t`Credits`,
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.totalCredits)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: ({ row }) => formatDate(row.original.createdAt),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: ({ row }) => formatDate(row.original.updatedAt),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return defaultColumns;
    }, [currencyFormatter, people.map, t]);

    const renderContextMenu = useCallback(
      (row: JournalEntryListItem) => {
        const isDraft = row.status === "Draft";
        return (
          <>
            <MenuItem
              disabled={!permissions.can("view", "accounting")}
              onClick={() => {
                navigate(path.to.journalEntryDetails(row.id?.toString()!));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {isDraft ? t`Edit Journal Entry` : t`View Journal Entry`}
            </MenuItem>
            <MenuItem
              disabled={!isDraft || !permissions.can("delete", "accounting")}
              destructive
              onClick={() => {
                setSelectedEntry(row);
                deleteModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Journal Entry</Trans>
            </MenuItem>
          </>
        );
      },
      [deleteModal, navigate, permissions, t]
    );

    return (
      <>
        <Table<JournalEntryListItem>
          data={data}
          columns={columns}
          count={count}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title={t`Journal Entries`}
        />
        {selectedEntry && selectedEntry.id && (
          <ConfirmDelete
            action={path.to.deleteJournalEntry(selectedEntry.id.toString())}
            isOpen={deleteModal.isOpen}
            name={selectedEntry.journalEntryId ?? ""}
            text={t`Are you sure you want to delete ${selectedEntry.journalEntryId}?`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedEntry(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedEntry(null);
            }}
          />
        )}
      </>
    );
  }
);

JournalEntriesTable.displayName = "JournalEntriesTable";
export default JournalEntriesTable;
