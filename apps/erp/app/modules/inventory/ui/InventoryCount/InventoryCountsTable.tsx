import type { Database } from "@carbon/database";
import { Constants } from "@carbon/database";
import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClock,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import {
  useDateFormatter,
  usePermissions,
  useRealtime,
  useUrlParams
} from "~/hooks";
import type { InventoryCount } from "~/modules/inventory";
import { InventoryCountStatus } from "~/modules/inventory";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type InventoryCountsTableProps = {
  data: InventoryCount[];
  count: number;
  locations: { id: string; name: string }[];
};

const InventoryCountsTable = memo(
  ({ data, count, locations }: InventoryCountsTableProps) => {
    useRealtime("inventoryCount", `id=in.(${data.map((d) => d.id).join(",")})`);

    const [params] = useUrlParams();
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const [people] = usePeople();

    const columns = useMemo<ColumnDef<InventoryCount>[]>(() => {
      return [
        {
          accessorKey: "inventoryCountId",
          header: t`Count ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.inventoryCount(row.original.id!)}>
              {row.original.inventoryCountId}
            </Hyperlink>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) =>
            locations.find((l) => l.id === row.original.locationId)?.name ??
            null,
          meta: {
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.id,
                label: location.name
              }))
            },
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: (item) => {
            const status =
              item.getValue<
                Database["public"]["Enums"]["inventoryCountStatus"]
              >();
            return <InventoryCountStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: Constants.public.Enums.inventoryCountStatus.map(
                (type) => ({
                  value: type,
                  label: <InventoryCountStatus status={type} />
                })
              )
            },
            pluralHeader: t`Statuses`,
            icon: <LuClock />
          }
        },
        {
          id: "postedBy",
          header: t`Posted By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.postedBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "postedAt",
          header: t`Posted At`,
          cell: (item) =>
            item.getValue<string>()
              ? formatDate(item.getValue<string>())
              : null,
          meta: { icon: <LuCalendar /> }
        },
        {
          id: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
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
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: { icon: <LuCalendar /> }
        }
      ];
    }, [people, locations, t, formatDate]);

    const [selected, setSelected] = useState<InventoryCount | null>(null);
    const deleteModal = useDisclosure();

    const renderContextMenu = useCallback(
      (row: InventoryCount) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.inventoryCount(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {row.status === "Draft" ? t`Edit Count` : t`View Count`}
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "inventory") ||
                row.status === "Posted"
              }
              destructive
              onClick={() => {
                setSelected(row);
                deleteModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Count</Trans>
            </MenuItem>
          </>
        );
      },
      [deleteModal, navigate, params, permissions, t]
    );

    return (
      <>
        <Table<InventoryCount>
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={{ left: ["inventoryCountId"] }}
          primaryAction={
            permissions.can("create", "inventory") && (
              <New label={t`Inventory Count`} to={path.to.newInventoryCount} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Inventory Count`}
          table="inventoryCount"
          withSavedView
        />
        {selected && selected.id && (
          <ConfirmDelete
            action={path.to.inventoryCountDelete(selected.id)}
            isOpen={deleteModal.isOpen}
            name={selected.inventoryCountId!}
            text={t`Are you sure you want to delete ${selected.inventoryCountId}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelected(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelected(null);
            }}
          />
        )}
      </>
    );
  }
);

InventoryCountsTable.displayName = "InventoryCountsTable";
export default InventoryCountsTable;
