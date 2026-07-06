import { Button, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookmark,
  LuCalendar,
  LuCirclePlus,
  LuClock,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { pickingListStatusType } from "../../inventory.models";
import PickingListStatus from "./PickingListStatus";

export type PickingList = {
  id: string;
  pickingListId: string;
  status: (typeof pickingListStatusType)[number];
  locationId: string;
  locationName: string;
  assignee: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  dueDate: string | null;
  lineCount: number;
  completedLineCount: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

type PickingListsTableProps = {
  data: PickingList[];
  count: number;
};

const PickingListsTable = memo(({ data, count }: PickingListsTableProps) => {
  const [params] = useUrlParams();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<PickingList>[]>(() => {
    return [
      {
        accessorKey: "pickingListId",
        header: t`Picking List ID`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.pickingListDetails(row.original.id)}>
            {row.original.pickingListId}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookmark />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: (item) => {
          const status =
            item.getValue<(typeof pickingListStatusType)[number]>();
          return <PickingListStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: pickingListStatusType.map((type) => ({
              value: type,
              label: <PickingListStatus status={type} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuClock />
        }
      },
      {
        id: "assignee",
        header: t`Assignee`,
        cell: ({ row }) =>
          row.original.assignee ? (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ) : (
            "Unassigned"
          ),
        meta: {
          icon: <LuUser />
        }
      },
      {
        id: "location",
        header: t`Location`,
        cell: ({ row }) => row.original.locationName || "N/A",
        meta: {
          icon: <LuMapPin />
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: (item) => {
          const date = item.getValue<string>();
          return date ? formatDate(date) : "N/A";
        },
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "progress",
        header: t`Progress`,
        cell: ({ row }) => {
          const total = row.original.lineCount ?? 0;
          const completed = row.original.completedLineCount ?? 0;
          return `${completed}/${total}`;
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />
        }
      }
    ];
  }, [t, formatDate]);

  const [selectedPickingList, setSelectedPickingList] =
    useState<PickingList | null>(null);
  const deleteModal = useDisclosure();

  const renderContextMenu = useCallback(
    (row: PickingList) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "inventory")}
            onClick={() => {
              navigate(
                `${path.to.pickingListDetails(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {row.status !== "Draft"
              ? t`View Picking List`
              : t`Edit Picking List`}
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "inventory") || row.status !== "Draft"
            }
            destructive
            onClick={() => {
              setSelectedPickingList(row);
              deleteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Picking List</Trans>
          </MenuItem>
        </>
      );
    },
    [deleteModal, navigate, params, permissions, t]
  );

  return (
    <>
      <Table<PickingList>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["pickingListId"]
        }}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false
        }}
        primaryAction={
          permissions.can("create", "inventory") ? (
            <Button asChild leftIcon={<LuCirclePlus />}>
              <Link to={path.to.pickingSchedule}>
                <Trans>New Picking List</Trans>
              </Link>
            </Button>
          ) : undefined
        }
        renderContextMenu={renderContextMenu}
        title={t`Picking Lists`}
      />
      {selectedPickingList && selectedPickingList.id && (
        <ConfirmDelete
          action={path.to.pickingListDelete(selectedPickingList.id)}
          isOpen={deleteModal.isOpen}
          name={selectedPickingList.pickingListId}
          text={`Are you sure you want to delete ${selectedPickingList.pickingListId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
            setSelectedPickingList(null);
          }}
          onSubmit={() => {
            deleteModal.onClose();
            setSelectedPickingList(null);
          }}
        />
      )}
    </>
  );
});

PickingListsTable.displayName = "PickingListsTable";
export default PickingListsTable;
