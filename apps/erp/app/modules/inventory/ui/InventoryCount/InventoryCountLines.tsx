import { Badge, HStack, Skeleton, toast, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import {
  LuBox,
  LuCalculator,
  LuExpand,
  LuGlassWater,
  LuHash,
  LuPackage,
  LuPaintBucket,
  LuPuzzle,
  LuShapes,
  LuStar,
  LuTag,
  LuWarehouse
} from "react-icons/lu";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table
} from "~/components";
import { EditableNumber } from "~/components/Editable";
import { Enumerable } from "~/components/Enumerable";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import type { InventoryCountLine } from "~/modules/inventory";
import { inventoryItemTypes } from "~/modules/inventory";
import type { ListItem } from "~/types";
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
  // Option lists for the column filters (same set the quantities screen uses).
  forms: ListItem[];
  substances: ListItem[];
  tags: string[];
  storageTypes: { id: string; name: string }[];
  storageUnits: { id: string; name: string }[];
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
  invalidLineIds,
  forms,
  substances,
  tags,
  storageTypes,
  storageUnits
}: InventoryCountLinesProps) => {
  const { t } = useLingui();

  const invalidLineIdSet = useMemo(
    () => new Set(invalidLineIds ?? []),
    [invalidLineIds]
  );

  // Build the inventory query filter: scope to this count's location and search
  // the quantities page for the item's readable id.
  const buildItemLink = useCallback(
    (itemId: string | null, readableId?: string) => {
      const next = new URLSearchParams();
      next.set("search", readableId ?? "");
      return `${path.to.inventoryItem(itemId ?? "")}?${next.toString()}`;
    },
    []
  );

  const hideSystem = hideSystemQuantity;

  const storageUnitsList = useStorageUnits(locationId);
  // The options resolve asynchronously; until they do, render a loading
  // placeholder instead of flashing the raw storage-unit id.
  const storageUnitsLoaded = !locationId || storageUnitsList.data !== undefined;
  const storageUnitLabel = useCallback(
    (id: string | null | undefined) =>
      storageUnitsList.options?.find((s) => s.value === id)?.label ?? "—",
    [storageUnitsList.options]
  );

  // The dependent material filters (finish/grade/dimension/type) narrow by the
  // currently-selected substance/shape — read straight back out of the URL.
  const activeFilters = useFilters();
  const materialSubstanceId = activeFilters.getFilter(
    "materialSubstanceId"
  )?.[0];
  const materialFormId = activeFilters.getFilter("materialFormId")?.[0];

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
          const item = row.original;
          return (
            <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
              <ItemThumbnail
                size="md"
                thumbnailPath={item.itemThumbnailPath}
                // The view's `type` union is broader than ItemThumbnail's — it
                // also allows "Fixture", which the thumbnail can't render — so
                // drop it rather than assert the type away.
                type={
                  item.type == null || item.type === "Fixture"
                    ? undefined
                    : item.type
                }
              />
              <Hyperlink
                to={buildItemLink(
                  item.itemId,
                  item.itemReadableIdWithRevision ?? undefined
                )}
              >
                <VStack spacing={0}>
                  {item.itemReadableIdWithRevision ?? item.itemId}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {item.itemName}
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
        accessorKey: "type",
        header: t`Item Type`,
        cell: ({ row }) => {
          const type = row.original.type;
          return type ? (
            <HStack spacing={2}>
              <MethodItemTypeIcon type={type} />
              <span>{type}</span>
            </HStack>
          ) : (
            "—"
          );
        },
        meta: {
          filter: {
            type: "static",
            options: inventoryItemTypes.map((type) => ({
              label: (
                <HStack spacing={2}>
                  <MethodItemTypeIcon type={type} />
                  <span>{type}</span>
                </HStack>
              ),
              value: type
            }))
          },
          icon: <LuBox />
        }
      },
      {
        accessorKey: "storageUnitId",
        header: t`Storage Unit`,
        cell: ({ row }) => {
          const id = row.original.storageUnitId;
          if (!id) return "—";
          if (!storageUnitsLoaded) return <Skeleton className="h-4 w-24" />;
          return storageUnitLabel(id);
        },
        meta: {
          filter: {
            type: "static",
            options: storageUnits.map((su) => ({
              value: su.id,
              label: <Enumerable value={su.name} />
            }))
          },
          exportValue: (row) => storageUnitLabel(row.storageUnitId),
          icon: <LuBox />
        }
      },
      {
        accessorKey: "storageTypeIds",
        header: t`Storage Type`,
        cell: ({ row }) => {
          const ids = row.original.storageTypeIds ?? [];
          return (
            <HStack spacing={0} className="gap-1">
              {ids.map((id) => {
                const st = storageTypes.find((s) => s.id === id);
                return <Enumerable key={id} value={st?.name ?? null} />;
              })}
            </HStack>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: storageTypes.map((st) => ({
              value: st.id,
              label: <Enumerable value={st.name} />
            })),
            isArray: true
          },
          pluralHeader: t`Storage Types`,
          icon: <LuWarehouse />
        }
      },
      {
        accessorKey: "materialSubstanceId",
        header: t`Substance`,
        cell: ({ row }) => {
          const substance = substances.find(
            (s) => s.id === row.original.materialSubstanceId
          );
          return <Enumerable value={substance?.name ?? null} />;
        },
        meta: {
          filter: {
            type: "static",
            options: substances.map((substance) => ({
              label: <Enumerable value={substance.name ?? null} />,
              value: substance.id
            }))
          },
          icon: <LuGlassWater />
        }
      },
      {
        accessorKey: "materialFormId",
        header: t`Shape`,
        cell: ({ row }) => {
          const form = forms.find((f) => f.id === row.original.materialFormId);
          return <Enumerable value={form?.name ?? null} />;
        },
        meta: {
          filter: {
            type: "static",
            options: forms.map((form) => ({
              label: <Enumerable value={form.name} />,
              value: form.id
            }))
          },
          icon: <LuShapes />
        }
      },
      {
        accessorKey: "finish",
        header: t`Finish`,
        cell: (item) => item.getValue() ?? "—",
        meta: {
          icon: <LuPaintBucket />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialFinishes(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({ value: name, label: name })) ?? []
          }
        }
      },
      {
        accessorKey: "grade",
        header: t`Grade`,
        cell: (item) => item.getValue() ?? "—",
        meta: {
          icon: <LuStar />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialGrades(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({ value: name, label: name })) ?? []
          }
        }
      },
      {
        accessorKey: "dimension",
        header: t`Dimension`,
        cell: (item) => item.getValue() ?? "—",
        meta: {
          icon: <LuExpand />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialDimensions(materialFormId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({ value: name, label: name })) ?? []
          }
        }
      },
      {
        accessorKey: "materialType",
        header: t`Material Type`,
        cell: (item) => item.getValue() ?? "—",
        meta: {
          icon: <LuPuzzle />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialTypes(
              materialSubstanceId,
              materialFormId
            ),
            // The `materialType` column holds the type's name, so the filter
            // value must be the name to match.
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({ value: name, label: name })) ?? []
          }
        }
      },
      {
        accessorKey: "tags",
        header: t`Tags`,
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {(row.original.tags ?? []).map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag,
              label: <Badge variant="secondary">{tag}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
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
        // Marked so the keyboard "Start counting" entry can locate the first
        // editable cell and seed the table's selection (see below).
        return (
          <span data-counted-qty className="tabular-nums">
            {value === null ? "—" : value}
          </span>
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
  }, [
    buildItemLink,
    forms,
    hideSystem,
    materialFormId,
    materialSubstanceId,
    storageTypes,
    storageUnitLabel,
    storageUnits,
    storageUnitsLoaded,
    substances,
    tags,
    t
  ]);

  // The material attributes are filter-only — hidden by default (the item column
  // already identifies the row) but available in the column picker.
  const defaultColumnVisibility = {
    type: false,
    storageTypeIds: false,
    materialSubstanceId: false,
    materialFormId: false,
    finish: false,
    grade: false,
    dimension: false,
    materialType: false,
    tags: false
  };

  const gridRef = useRef<HTMLDivElement>(null);

  // Last-resolved Counted Qty column index, cached as a fallback. It's resolved
  // live from the DOM on each keypress (below) so showing / hiding / reordering
  // columns can never point navigation at the wrong cell.
  const countedColumnRef = useRef<string | null>(null);

  // Focus the first not-yet-edited Counted Qty cell. The shared Table only
  // seeds its cell selection on a mouse click, so we click the cell to bootstrap
  // its selection + edit; from there the counting keyboard flow below takes over.
  // Scoped to this grid via the `data-counted-qty` marker.
  const enterGrid = useCallback(() => {
    (
      gridRef.current?.querySelector("[data-counted-qty]") ??
      document.querySelector("[data-counted-qty]")
    )
      ?.closest<HTMLElement>("[data-column]")
      ?.click();
  }, []);

  // Take every focusable inside the grid lines out of the tab order — the only
  // ones are the item name's link + its hover "Open" button (from the shared
  // Hyperlink), which would otherwise capture Tab. This leaves the selected
  // Counted Qty cell as the single line-level tab stop, so Tab drives counting.
  // Runs each render since the Table re-mounts row cells; the Counted Qty editor
  // is an <input>, not an <a>/<button>, so it's untouched.
  useEffect(() => {
    for (const el of gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-row] a, [data-row] button"
    ) ?? []) {
      el.tabIndex = -1;
    }
  });

  // Land the counter in the first cell on open (Draft counts only), so the page
  // is immediately keyboard-driveable without hunting for an entry point.
  const hasAutoFocusedRef = useRef(false);
  useEffect(() => {
    if (isReadOnly || hasAutoFocusedRef.current || lines.length === 0) return;
    hasAutoFocusedRef.current = true;
    enterGrid();
  }, [isReadOnly, lines.length, enterGrid]);

  // Spreadsheet-style entry: Enter/Tab commit the current count and move to the
  // NEXT line's Counted Qty cell; Shift+Tab moves to the PREVIOUS line. A keypress
  // from any other cell jumps into the Counted Qty column instead of letting the
  // shared Table wander sideways. At a boundary, Enter keeps focus on the cell
  // while Tab is allowed to leave the grid (only the Table's own wrap is
  // suppressed). Read-only counts are left entirely to the browser. Runs in the
  // capture phase — this wrapper is an ancestor of the Table's own capture
  // listener — so stopping propagation overrides it.
  const onGridKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (isReadOnly) return;
      if (event.key !== "Enter" && event.key !== "Tab") return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row][data-column]"
      );
      if (!cell || !gridRef.current?.contains(cell)) return;

      // Resolve the Counted Qty column live: from the cell being edited (only the
      // Counted Qty cell is editable) or, failing that, the `data-counted-qty`
      // marker on any non-editing line. Falls back to the last-known index.
      const active = document.activeElement as HTMLElement | null;
      const editingColumn =
        active?.tagName === "INPUT"
          ? active
              .closest<HTMLElement>("[data-column]")
              ?.getAttribute("data-column")
          : null;
      const markerColumn = gridRef.current
        ?.querySelector("[data-counted-qty]")
        ?.closest<HTMLElement>("[data-column]")
        ?.getAttribute("data-column");
      const countedColumn =
        editingColumn ?? markerColumn ?? countedColumnRef.current;
      if (!countedColumn) return;
      countedColumnRef.current = countedColumn;

      const row = Number(cell.getAttribute("data-row"));

      // From another column (e.g. a clicked Item cell), jump into this line's
      // Counted Qty cell.
      if (cell.getAttribute("data-column") !== countedColumn) {
        event.preventDefault();
        event.stopPropagation();
        gridRef.current
          ?.querySelector<HTMLElement>(
            `[data-row="${row}"][data-column="${countedColumn}"]`
          )
          ?.click();
        return;
      }

      const step = event.key === "Tab" && event.shiftKey ? -1 : 1;
      const adjacent = gridRef.current?.querySelector<HTMLElement>(
        `[data-row="${row + step}"][data-column="${countedColumn}"]`
      );

      // Let Tab exit the grid at the first/last line rather than trapping focus;
      // only suppress the Table's own row-wrapping.
      if (event.key === "Tab" && !adjacent) {
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (active?.tagName === "INPUT") active.blur(); // commit before moving
      if (adjacent) {
        adjacent.click(); // open the next line's cell for entry
      } else {
        // Enter at a boundary: keep focus on the cell rather than dropping out.
        cell.focus();
      }
    },
    [isReadOnly]
  );

  const editableComponents = useMemo(
    () => ({
      countedQuantity: EditableNumber<InventoryCountLine>(
        onCellEdit,
        // Serial-tracked lines are a single unique unit — cap the counted
        // quantity at 1 (per row, since tracking type varies by line).
        (row) => ({
          minValue: 0,
          maxValue: row.itemTrackingType === "Serial" ? 1 : undefined
        }),
        { clearable: true }
      )
    }),
    [onCellEdit]
  );

  return (
    <div
      ref={gridRef}
      onKeyDownCapture={onGridKeyDownCapture}
      className="flex h-full min-h-0 w-full flex-col"
    >
      {/* Keyboard skip-link into the grid: revealed on focus, activates the
          first Counted Qty cell so counters can enter and drive the grid
          without a mouse. */}
      {!isReadOnly && lines.length > 0 && (
        <button
          type="button"
          onClick={enterGrid}
          className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:m-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground focus:shadow"
        >
          {t`Start counting`}
        </button>
      )}
      <Table<InventoryCountLine>
        compact
        columns={columns}
        data={lines}
        count={count}
        defaultColumnVisibility={defaultColumnVisibility}
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
    </div>
  );
};

export default InventoryCountLines;
