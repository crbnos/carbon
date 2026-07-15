import { Badge, HStack, Skeleton, toast, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo } from "react";
import { LuBox, LuCalculator, LuHash, LuPackage } from "react-icons/lu";
import { Hyperlink, ItemThumbnail, Table } from "~/components";
import { EditableNumber } from "~/components/Editable";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import type { InventoryCountLine } from "~/modules/inventory";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";

type InventoryCountLinesProps = {
  lines: InventoryCountLine[];
  count: number;
  // Blind counting withholds System Qty + Variance until Posted; the caller
  // decides when — kept separate from the read-only (Draft) edit gate.
  hideSystemQuantity: boolean;
  isReadOnly: boolean;
  locationId: string;
  title?: string;
  titleBadge?: ReactNode;
  primaryAction?: ReactNode;
  // Line ids the last post attempt rejected (snapshot drift or invalid serial
  // quantity) — highlighted red until fixed.
  invalidLineIds?: string[];
};

const InventoryCountLines = ({
  lines,
  count,
  hideSystemQuantity,
  isReadOnly,
  locationId,
  title,
  titleBadge,
  primaryAction,
  invalidLineIds
}: InventoryCountLinesProps) => {
  const { t } = useLingui();

  const invalidLineIdSet = useMemo(
    () => new Set(invalidLineIds ?? []),
    [invalidLineIds]
  );

  // Build the inventory query filter: scope to this count's location and search
  // the quantities page for the item's readable id.
  const buildItemLink = useCallback((itemId: string, readableId?: string) => {
    const next = new URLSearchParams();
    next.set("search", readableId ?? "");
    return `${path.to.inventoryItem(itemId)}?${next.toString()}`;
  }, []);

  const hideSystem = hideSystemQuantity;

  const storageUnits = useStorageUnits(locationId);
  // The options resolve asynchronously; until they do, render a loading
  // placeholder instead of flashing the raw storage-unit id.
  const storageUnitsLoaded = !locationId || storageUnits.data !== undefined;
  const storageUnitLabel = useCallback(
    (id: string | null | undefined) =>
      storageUnits.options?.find((s) => s.value === id)?.label ?? "—",
    [storageUnits.options]
  );

  // Inline edits persist one line at a time through the `lines.update` route
  // action, which enforces the Draft-only guard server-side and stamps the count
  // audit fields. The returned `{ error }` shape lets the editable cell revert
  // its optimistic value on failure.
  const onCellEdit = useCallback(
    async (
      _accessorKey: string,
      value: unknown,
      row: InventoryCountLine
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const formData = new FormData();
      formData.set("id", row.id!);
      formData.set(
        "countedQuantity",
        value === "" || value == null ? "" : String(value)
      );

      const response = await fetch(path.to.inventoryCountLineUpdate, {
        method: "post",
        body: formData
      });

      const error = response.ok ? null : { message: "Failed to update count" };
      if (error) toast.error(t`Failed to update count`);
      return {
        data: null,
        error
      } as unknown as PostgrestSingleResponse<unknown>;
    },
    [t]
  );

  const columns = useMemo<ColumnDef<InventoryCountLine>[]>(() => {
    const cols: ColumnDef<InventoryCountLine>[] = [
      {
        id: "item",
        header: t`Item`,
        cell: ({ row }) => {
          const item = (
            row.original as {
              item?: {
                name?: string;
                readableIdWithRevision?: string;
                type?: MethodItemType;
                thumbnailPath?: string | null;
              };
            }
          ).item;
          return (
            <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
              <ItemThumbnail
                size="md"
                thumbnailPath={item?.thumbnailPath}
                type={item?.type}
              />
              <Hyperlink
                to={buildItemLink(
                  row.original.itemId,
                  item?.readableIdWithRevision
                )}
              >
                <VStack spacing={0}>
                  {item?.readableIdWithRevision ?? row.original.itemId}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {item?.name}
                  </div>
                </VStack>
              </Hyperlink>
            </HStack>
          );
        },
        meta: { icon: <LuPackage /> }
      },
      {
        accessorKey: "readableId",
        header: t`Batch / Serial`,
        cell: (item) => item.getValue<string>() ?? "—",
        meta: { icon: <LuHash /> }
      },
      {
        id: "storageUnit",
        header: t`Storage Unit`,
        cell: ({ row }) => {
          const id = row.original.storageUnitId;
          if (!id) return "—";
          if (!storageUnitsLoaded) return <Skeleton className="h-4 w-24" />;
          return storageUnitLabel(id);
        },
        meta: { icon: <LuBox /> }
      }
    ];

    if (!hideSystem) {
      cols.push({
        accessorKey: "systemQuantity",
        header: t`System Qty`,
        cell: (item) => (
          <span className="tabular-nums">{Number(item.getValue() ?? 0)}</span>
        ),
        meta: { icon: <LuHash /> }
      });
    }

    cols.push({
      accessorKey: "countedQuantity",
      header: t`Counted Qty`,
      cell: (item) => {
        const value = item.getValue<number | null>();
        return (
          <span className="tabular-nums">{value === null ? "—" : value}</span>
        );
      },
      meta: { icon: <LuCalculator /> }
    });

    if (!hideSystem) {
      cols.push({
        id: "variance",
        header: t`Variance`,
        cell: ({ row }) => {
          const counted = row.original.countedQuantity;
          if (counted === null || counted === undefined) return "—";
          const variance =
            Number(counted) - Number(row.original.systemQuantity);
          if (variance === 0) return <span className="tabular-nums">0</span>;
          return (
            <Badge variant={variance < 0 ? "destructive" : "green"}>
              {variance > 0 ? `+${variance}` : variance}
            </Badge>
          );
        },
        meta: { icon: <LuCalculator /> }
      });
    }

    return cols;
  }, [buildItemLink, hideSystem, storageUnitLabel, storageUnitsLoaded, t]);

  const editableComponents = useMemo(
    () => ({
      countedQuantity: EditableNumber<InventoryCountLine>(
        onCellEdit,
        // Serial-tracked lines are a single unique unit — cap the counted
        // quantity at 1 (per row, since tracking type varies by line).
        (row) => ({
          minValue: 0,
          maxValue:
            (row as { item?: { itemTrackingType?: string } }).item
              ?.itemTrackingType === "Serial"
              ? 1
              : undefined
        }),
        { clearable: true }
      )
    }),
    [onCellEdit]
  );

  return (
    <Table<InventoryCountLine>
      compact
      columns={columns}
      data={lines}
      count={count}
      editableComponents={editableComponents}
      getRowClassName={(row) =>
        invalidLineIdSet.has(row.id ?? "")
          ? "bg-destructive/30 hover:bg-destructive/40"
          : undefined
      }
      primaryAction={primaryAction}
      title={title ?? t`Lines`}
      titleBadge={titleBadge}
      withInlineEditing={!isReadOnly}
      // Draft counts are inherently editable — no Edit/Lock toggle, always on.
      forceEditMode={!isReadOnly}
    />
  );
};

export default InventoryCountLines;
