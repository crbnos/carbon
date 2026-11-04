// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  PulsingDot,
  Status,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBlocks,
  LuCalendar,
  LuCheck,
  LuContainer,
  LuEllipsisVertical,
  LuHash,
  LuPencil,
  LuPrinter,
  LuRefreshCw,
  LuSettings,
  LuTrash
} from "react-icons/lu";
import { Link } from "react-router";
import {
  DateTime,
  exportOnlyColumn,
  Highlight,
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  New,
  SupplierAvatar,
  searchMatches,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, usePrinting, useUrlParams } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { useSuppliers } from "~/stores";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import type { KanbanItem, KanbanSummary } from "../../types";
import {
  KanbanCodeLinks,
  type KanbanOutput,
  KanbanQrCodeProvider
} from "./KanbanCodeLinks";

type KanbansTableProps = {
  data: KanbanItemRow[];
  count: number;
  // The loader's cursor for the next page (infinite scroll).
  nextCursor: string | null;
  locationId: string;
  kanbanOutput: KanbanOutput;
};

/** A kanban in an item row, plus the projected quantity at its To storage unit
 *  (armed Transfer kanbans only; null otherwise). */
type KanbanRow = KanbanSummary & { projectedQuantity: number | null };

/** A list row: one item at the location, with its kanbans. */
type KanbanItemRow = Omit<KanbanItem, "kanbans"> & { kanbans: KanbanRow[] };

const defaultColumnVisibility = {
  createdAt: false
};

/** One row per item; its kanbans are the expanded row, open while a search
 *  is, with the matches marked. */
const KanbansTable = memo(
  ({
    data,
    count,
    nextCursor,
    locationId,
    kanbanOutput
  }: KanbansTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const formatQuantity = useQuantityFormatter();
    const search = params.get("search");

    const permissions = usePermissions();
    const [items] = useItems();
    const [suppliers] = useSuppliers();
    const locations = useLocations();

    const columns = useMemo<ColumnDef<KanbanItemRow>[]>(() => {
      const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
      return [
        {
          accessorKey: "itemId",
          header: t`Item`,
          // Clicking the row expands its kanbans.
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
              />
              <VStack spacing={0}>
                <span className="text-sm font-medium">
                  <Highlight
                    text={row.original.name}
                    ranges={searchMatches(row.original.name, search)}
                  />
                </span>
                <span className="text-xs text-muted-foreground">
                  <Highlight
                    text={row.original.readableIdWithRevision}
                    ranges={searchMatches(
                      row.original.readableIdWithRevision,
                      search
                    )}
                  />
                </span>
              </VStack>
            </HStack>
          ),
          meta: {
            mobile: "P1",
            filter: {
              type: "static",
              options: items?.map((item) => ({
                value: item.id,
                label: item.readableIdWithRevision
              }))
            },
            icon: <LuBlocks />,
            // Without this the exporter substitutes the item's name for the id
            // (Download.tsx idNameMaps), losing the readable id.
            exportValue: (row) => row.readableIdWithRevision ?? null
          }
        },
        exportOnlyColumn<KanbanItemRow>({
          id: "itemName",
          header: t`Item Name`,
          value: (row) => row.name ?? null
        }),
        {
          accessorKey: "kanbanCount",
          header: t`Kanbans`,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.kanbanCount}</span>
          ),
          meta: { mobile: "P2", icon: <LuHash /> }
        },
        {
          accessorKey: "replenishmentSystems",
          header: t`Replenishment`,
          cell: ({ row }) => (
            <HStack spacing={1}>
              {row.original.replenishmentSystems?.map((system) => (
                <Enumerable key={system} value={system} />
              ))}
            </HStack>
          ),
          meta: {
            mobile: "P2",
            filter: {
              type: "static",
              options: ["Buy", "Make", "Transfer"].map((type) => ({
                value: type,
                label: <Enumerable value={type} />
              })),
              isArray: true
            },
            icon: <LuRefreshCw />,
            exportValue: (row) =>
              row.replenishmentSystems?.length
                ? row.replenishmentSystems.join(", ")
                : null
          }
        },
        {
          accessorKey: "supplierIds",
          header: t`Supplier`,
          cell: ({ row }) => (
            <HStack spacing={1}>
              {row.original.supplierIds?.map((supplierId) => (
                <SupplierAvatar key={supplierId} supplierId={supplierId} />
              ))}
            </HStack>
          ),
          meta: {
            mobile: "P3",
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              })),
              isArray: true
            },
            exportValue: (row) =>
              row.supplierIds?.length
                ? row.supplierIds
                    .map((id) => supplierNames.get(id) ?? id)
                    .join(", ")
                : null
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: ({ row }) => (
            <DateTime value={row.original.updatedAt} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: ({ row }) => (
            <DateTime value={row.original.createdAt} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        // The kanbans live in the expanded row, which the CSV cannot carry.
        exportOnlyColumn<KanbanItemRow>({
          id: "kanbanIds",
          header: t`Kanban IDs`,
          value: (row) =>
            row.kanbans
              .map((kanban) => kanban.kanbanId)
              .filter(Boolean)
              .join(", ")
        })
      ];
    }, [items, search, suppliers, t]);

    /* Printing kanban cards (one row, or the selection): to a configured
       printer, the location's Kanbans printer first (a Zebra prints at its own
       media size), one card per action, so a Make kanban prints Create, Start
       and Complete. With no printer, the same cards as one PDF at the
       company's Label Size. */
    const { printerRoutes, resolvePrinterRoute } = usePrinting();
    const printerModal = useDisclosure();
    const defaultPrinter = resolvePrinterRoute(locationId, "kanban");
    const [printIds, setPrintIds] = useState<string[]>([]);
    const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
    const [isPrinting, setIsPrinting] = useState(false);

    const handlePrintLabels = useCallback(
      (ids: string[]) => {
        if (ids.length === 0) return;
        if (printerRoutes.length > 0) {
          setPrintIds(ids);
          setSelectedPrinterId(
            defaultPrinter?.id ?? printerRoutes[0]?.id ?? ""
          );
          printerModal.onOpen();
        } else {
          window.open(path.to.file.kanbanLabelsPdf(ids, "all"), "_blank");
        }
      },
      [printerRoutes, defaultPrinter?.id, printerModal]
    );

    // Raw fetch (not a fetcher): parallel submissions don't abort each other
    // and nothing revalidates, so the selection stays intact.
    const handleConfirmPrint = useCallback(async () => {
      if (printIds.length === 0 || !selectedPrinterId) return;

      setIsPrinting(true);
      try {
        const results = await Promise.allSettled(
          printIds.map((id) =>
            fetch(path.to.manualPrint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceDocument: "Kanban",
                sourceDocumentId: id,
                locationId,
                printerRouteId: selectedPrinterId
              })
            })
          )
        );

        const failed = results.filter(
          (r) => r.status === "rejected" || !r.value.ok
        ).length;

        if (failed > 0) {
          toast.error(t`${failed} of ${printIds.length} print jobs failed`);
        } else {
          toast.success(t`Queued ${printIds.length} kanbans for printing`);
        }
      } finally {
        setIsPrinting(false);
        printerModal.onClose();
      }
    }, [printIds, selectedPrinterId, locationId, printerModal, t]);

    const renderKanbanMenu = useCallback(
      (kanban: KanbanRow) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permissions.can("update", "inventory") && (
              <DropdownMenuItem shortcut={MENU_ITEM_SHORTCUTS.edit} asChild>
                <Link to={`${path.to.kanban(kanban.id)}?${params}`}>
                  <DropdownMenuIcon icon={<LuPencil />} />
                  <Trans>Edit</Trans>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => handlePrintLabels([kanban.id])}>
              <DropdownMenuIcon icon={<LuPrinter />} />
              <Trans>Print Label</Trans>
            </DropdownMenuItem>
            {permissions.can("delete", "inventory") && (
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.delete}
                destructive
                asChild
              >
                <Link to={`${path.to.deleteKanban(kanban.id)}?${params}`}>
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete</Trans>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      [handlePrintLabels, params, permissions, t]
    );

    const renderExpandedRow = useCallback(
      (row: KanbanItemRow) => (
        <div className="pl-[52px] pr-4">
          {row.kanbans.map((kanban) => {
            const level = kanban.replenishmentLevel;
            const projected = kanban.projectedQuantity;
            const isBelowLevel =
              level !== null && projected !== null && projected < level;
            return (
              <div key={kanban.id} className="flex gap-3 py-2 text-sm">
                <div
                  aria-hidden
                  className="w-5 shrink-0 border-l border-border -my-2"
                />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <Hyperlink to={`${path.to.kanban(kanban.id)}?${params}`}>
                    <span className="font-medium">
                      <Highlight
                        text={kanban.kanbanId ?? t`Kanban`}
                        ranges={searchMatches(kanban.kanbanId, search)}
                      />
                    </span>
                  </Hyperlink>
                  <Enumerable value={kanban.replenishmentSystem} />
                  {kanban.supplierId && (
                    <SupplierAvatar supplierId={kanban.supplierId} />
                  )}
                  <span className="truncate text-muted-foreground">
                    {kanban.replenishmentSystem === "Transfer"
                      ? `${kanban.fromStorageUnitName || "—"} → ${
                          kanban.storageUnitName || "—"
                        }`
                      : kanban.storageUnitName}
                  </span>
                  {kanban.jobId && kanban.jobReadableId && (
                    <Badge variant="outline">
                      <Link
                        to={path.to.job(kanban.jobId)}
                        className="flex flex-row items-center gap-1"
                      >
                        {kanban.jobReadableId}
                        <PulsingDot />
                      </Link>
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-6 tabular-nums">
                  {level !== null && (
                    <span className="whitespace-nowrap">
                      <span className="text-muted-foreground">
                        <Trans>Min</Trans>
                      </span>{" "}
                      {formatQuantity(level)}
                      {projected !== null && (
                        <span className="text-muted-foreground">
                          {" · "}
                          <Trans>Projected</Trans> {formatQuantity(projected)}
                        </span>
                      )}
                    </span>
                  )}
                  {isBelowLevel && (
                    <Status color="red">
                      <Trans>Below level</Trans>
                    </Status>
                  )}
                  <span className="whitespace-nowrap">
                    <span className="text-muted-foreground">
                      <Trans>Reorder Qty.</Trans>
                    </span>{" "}
                    <span className="font-medium">
                      {formatQuantity(kanban.quantity)}
                    </span>
                    {kanban.purchaseUnitOfMeasureCode &&
                      ` ${kanban.purchaseUnitOfMeasureCode}`}
                  </span>
                  <KanbanCodeLinks
                    kanban={kanban}
                    kanbanOutput={kanbanOutput}
                  />
                  {renderKanbanMenu(kanban)}
                </div>
              </div>
            );
          })}
        </div>
      ),
      [formatQuantity, kanbanOutput, params, renderKanbanMenu, search, t]
    );

    const renderContextMenu = useCallback(
      (row: KanbanItemRow) => {
        const item = items.find((i) => i.id === row.itemId);
        const itemType = item?.type;
        // Only show link for supported types (Service and Fixture not yet supported)
        const canViewItem =
          permissions.can("view", "inventory") &&
          !!row.itemId &&
          !!itemType &&
          itemType !== "Service" &&
          itemType !== "Fixture";

        return (
          <>
            <MenuItem
              onClick={() => handlePrintLabels(row.kanbans.map((k) => k.id))}
            >
              <LuPrinter className="mr-2 size-4" />
              {row.kanbans.length === 1 ? (
                <Trans>Print Label</Trans>
              ) : (
                <Trans>Print Labels</Trans>
              )}
            </MenuItem>
            {canViewItem && (
              <MenuItem shortcut={MENU_ITEM_SHORTCUTS.view} asChild>
                <Link to={getLinkToItemDetails(itemType, row.itemId!)}>
                  <MethodItemTypeIcon type={itemType} className="mr-2 size-4" />
                  <Trans>View Item Master</Trans>
                </Link>
              </MenuItem>
            )}
          </>
        );
      },
      [items, permissions, handlePrintLabels]
    );

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        const kanbanIds = selectedRows.flatMap((row) =>
          row.kanbans.map((kanban) => kanban.id)
        );
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>
              <Trans>Actions</Trans>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => handlePrintLabels(kanbanIds)}>
                <LuPrinter className="mr-2 size-4" />
                <Trans>Print Labels ({kanbanIds.length})</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        );
      },
      [handlePrintLabels]
    );

    return (
      <KanbanQrCodeProvider>
        <Table<KanbanItemRow>
          count={count}
          columns={columns}
          data={data}
          // Location-scoped: no list registry entry, so no `listKey`.
          infinite={{ dataKey: "kanbanItems", nextCursor }}
          defaultColumnVisibility={defaultColumnVisibility}
          renderExpandedRow={renderExpandedRow}
          expandRowsFor={search}
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
              <Button variant="secondary" asChild leftIcon={<LuSettings />}>
                <Link to={path.to.inventorySettings}>Settings</Link>
              </Button>
              {permissions.can("create", "inventory") && (
                <New label={t`Kanban`} to={path.to.newKanban} />
              )}
            </div>
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          title={t`Kanbans`}
          table="kanban"
          withSavedView
          withSelectableRows
        />
        {printerModal.isOpen && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) printerModal.onClose();
            }}
          >
            <ModalContent>
              <ModalHeader>
                <ModalTitle>
                  <Trans>Select Printer</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-1">
                  {printerRoutes.map((route) => (
                    <button
                      type="button"
                      key={route.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selectedPrinterId === route.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}
                      onClick={() => setSelectedPrinterId(route.id)}
                    >
                      <LuPrinter className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">
                          {route.name}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 uppercase">
                          {route.format}
                        </span>
                        {route.mediaSizeId && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {route.mediaSizeId}
                          </span>
                        )}
                      </div>
                      {selectedPrinterId === route.id && (
                        <LuCheck className="size-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </ModalBody>
              <ModalFooter>
                <HStack>
                  <Button
                    variant="primary"
                    leftIcon={<LuPrinter />}
                    isLoading={isPrinting}
                    disabled={!selectedPrinterId || isPrinting}
                    onClick={handleConfirmPrint}
                  >
                    <Trans>Print {printIds.length} Kanbans</Trans>
                  </Button>
                  <Button variant="solid" onClick={printerModal.onClose}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </KanbanQrCodeProvider>
    );
  }
);

KanbansTable.displayName = "KanbansTable";

export default KanbansTable;

function getLocationPath(locationId: string) {
  return `${path.to.kanbans}?location=${locationId}`;
}
