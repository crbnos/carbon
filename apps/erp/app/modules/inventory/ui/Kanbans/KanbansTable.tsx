import {
  Combobox,
  Copy,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  IconButton,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuContainer,
  LuHash,
  LuLink,
  LuMapPin,
  LuPackage,
  LuPencil,
  LuPrinter,
  LuQrCode,
  LuRefreshCw,
  LuTag,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
import { useSuppliers } from "~/stores";
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
  supplierName: false,
  createdAt: false,
  updatedBy: false,
  updatedAt: false,
};

const KanbansTable = memo(({ data, count, locationId }: KanbansTableProps) => {
  const [params] = useUrlParams();

  const permissions = usePermissions();
  const [people] = usePeople();
  const [items] = useItems();
  const [suppliers] = useSuppliers();
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
            <Tooltip>
              <TooltipTrigger>
                <IconButton
                  aria-label="Labels"
                  variant="secondary"
                  icon={<LuTag />}
                  onClick={() => {
                    window.open(
                      path.to.file.kanbanLabelsPdf([row.original.id!]),
                      "_blank"
                    );
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>Print Label</TooltipContent>
            </Tooltip>

            <HoverCard>
              <HoverCardTrigger>
                <IconButton
                  aria-label="QR Code"
                  variant="secondary"
                  icon={<LuQrCode />}
                />
              </HoverCardTrigger>
              <HoverCardContent
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
              </HoverCardContent>
            </HoverCard>
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
        cell: ({ row }) => {
          const { quantity, purchaseUnitOfMeasureCode } = row.original;
          const baseQuantity = quantity || 0;

          return (
            <span>
              {baseQuantity}
              {purchaseUnitOfMeasureCode && ` ${purchaseUnitOfMeasureCode}`}
            </span>
          );
        },
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
        accessorKey: "supplierId",
        header: "Supplier",
        cell: ({ row }) => (
          <SupplierAvatar supplierId={row.original.supplierId} />
        ),
        meta: {
          icon: <LuContainer />,
          filter: {
            type: "static",
            options: suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            })),
          },
        },
      },
      {
        accessorKey: "shelfName",
        header: "Shelf",
        cell: ({ row }) => row.original.shelfName || "",
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
    [items, params, people, suppliers]
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

  const renderActions = useCallback((selectedRows: typeof data) => {
    const handlePrintLabels = () => {
      const selectedIds = selectedRows
        .map((row) => row.id)
        .filter(Boolean) as string[];
      if (selectedIds.length > 0) {
        window.open(path.to.file.kanbanLabelsPdf(selectedIds), "_blank");
      }
    };

    return (
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handlePrintLabels}>
            <LuPrinter className="mr-2 h-4 w-4" />
            Print Labels ({selectedRows.length})
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    );
  }, []);

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
      renderActions={renderActions}
      renderContextMenu={renderContextMenu}
      title="Kanbans"
      table="kanban"
      withSavedView
      withSelectableRows
    />
  );
});

KanbansTable.displayName = "KanbansTable";

export default KanbansTable;

function getLocationPath(locationId: string) {
  return `${path.to.kanbans}?location=${locationId}`;
}
