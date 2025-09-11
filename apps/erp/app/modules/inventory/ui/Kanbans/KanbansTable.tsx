import {
  Combobox,
  Copy,
  HStack,
  IconButton,
  MenuItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuHash,
  LuLink,
  LuMapPin,
  LuPackage,
  LuPencil,
  LuQrCode,
  LuRefreshCw,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
import { useItems } from "~/stores/items";
import { usePeople } from "~/stores/people";
import { path } from "~/utils/path";
import type { Kanban } from "../../types";

type KanbansTableProps = {
  data: Kanban[];
  count: number;
  locationId: string;
};

const defaultColumnVisibility = {
  createdBy: false,
  createdAt: false,
  updatedBy: false,
  updatedAt: false,
};

const KanbansTable = memo(({ data, count, locationId }: KanbansTableProps) => {
  const [params] = useUrlParams();

  const permissions = usePermissions();
  const [people] = usePeople();
  const [items] = useItems();
  const locations = useLocations();

  const columns = useMemo<ColumnDef<Kanban>[]>(
    () => [
      {
        accessorKey: "itemId",
        header: "Item",
        cell: ({ row }) => (
          <HStack className="py-1">
            <Hyperlink to={`${path.to.kanban(row.original.id!)}?${params}`}>
              <VStack spacing={0}>
                {row.original.name}
                <div className="text-muted-foreground text-xs">
                  {row.original.readableIdWithRevision}
                </div>
              </VStack>
            </Hyperlink>
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: items?.map((item) => ({
              value: item.id,
              label: item.readableIdWithRevision,
            })),
          },
          icon: <LuPackage />,
        },
      },
      {
        id: "links",
        header: "",
        cell: ({ row }) => (
          <HStack>
            <Popover>
              <PopoverTrigger>
                <IconButton
                  aria-label="QR Code"
                  variant="secondary"
                  icon={<LuQrCode />}
                />
              </PopoverTrigger>
              <PopoverContent
                align="center"
                className="size-[236px] overflow-hidden z-[100] bg-white p-4"
              >
                <iframe
                  seamless
                  title={"Kanban QR Code"}
                  width="198"
                  height="198"
                  src={path.to.file.kanbanQrCode(row.original.id!)}
                />
              </PopoverContent>
            </Popover>
            <Copy
              text={`${
                typeof window === "undefined" ? "" : window.location.origin
              }${path.to.api.kanban(row.original.id!)}`}
              icon={<LuLink />}
              size="md"
            />
          </HStack>
        ),
      },
      {
        accessorKey: "quantity",
        header: "Reorder Qty.",
        cell: ({ row }) => row.original.quantity,
        meta: {
          icon: <LuHash />,
        },
      },
      {
        accessorKey: "replenishmentSystem",
        header: "Replenishment",
        cell: ({ row }) => (
          <Enumerable value={row.original.replenishmentSystem} />
        ),
        meta: {
          filter: {
            type: "static",
            options: ["Buy", "Make"].map((type) => ({
              value: type,
              label: <Enumerable value={type} />,
            })),
          },
          icon: <LuRefreshCw />,
        },
      },
      {
        accessorKey: "locationName",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable value={row.original.locationName || ""} />
        ),
        meta: {
          icon: <LuMapPin />,
        },
      },

      {
        accessorKey: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: <Enumerable value={employee.name} />,
            })),
          },
          icon: <LuUser />,
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt).toLocaleDateString()
            : "",
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: <Enumerable value={employee.name} />,
            })),
          },
          icon: <LuUser />,
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: ({ row }) =>
          row.original.updatedAt
            ? new Date(row.original.updatedAt).toLocaleDateString()
            : "",
        meta: {
          icon: <LuCalendar />,
        },
      },
    ],
    [items, params, people]
  );

  const renderContextMenu = useCallback(
    (row: Kanban) => {
      const canUpdate = permissions.can("update", "inventory");
      const canDelete = permissions.can("delete", "inventory");

      return (
        <>
          {canUpdate && (
            <MenuItem asChild>
              <Link to={`${path.to.kanban(row.id!)}?${params}`}>
                <LuPencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </MenuItem>
          )}
          {canDelete && (
            <MenuItem destructive asChild>
              <Link to={`${path.to.deleteKanban(row.id!)}?${params}`}>
                <LuTrash className="mr-2 h-4 w-4" />
                Delete
              </Link>
            </MenuItem>
          )}
        </>
      );
    },
    [params, permissions]
  );

  return (
    <Table<Kanban>
      count={count}
      columns={columns}
      data={data}
      defaultColumnVisibility={defaultColumnVisibility}
      primaryAction={
        <div className="flex items-center gap-2">
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              // hard refresh because initialValues update has no effect otherwise
              window.location.href = getLocationPath(selected);
            }}
          />
          {permissions.can("create", "inventory") && (
            <New label="Kanban" to={path.to.newKanban} />
          )}
        </div>
      }
      renderContextMenu={renderContextMenu}
      title="Kanbans"
      table="kanban"
      withSavedView
    />
  );
});

KanbansTable.displayName = "KanbansTable";

export default KanbansTable;

function getLocationPath(locationId: string) {
  return `${path.to.kanbans}?location=${locationId}`;
}
