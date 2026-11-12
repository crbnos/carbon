// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { useRuleViolations } from "@carbon/ee/rules";
import {
  Badge,
  Button,
  cn,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  NumberField,
  NumberInput,
  NumberInputGroup,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  toast,
  useViewport,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, RoundingMode, round } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuMousePointerClick,
  LuPackageSearch,
  LuQrCode,
  LuSearch,
  LuShapes,
  LuTrash2,
  LuTriangleAlert,
  LuWarehouse
} from "react-icons/lu";
import { Link } from "react-router";
import { ItemThumbnail } from "~/components";
import type { StorageUnitTreeRow } from "~/components/Form/StorageUnit";
import StorageUnit from "~/components/Form/StorageUnit";
import { PhoneActionBar } from "~/components/Layout/Mobile/ChromeSlots";
import { usePermissions, useQuantityFormatter } from "~/hooks";
import type { StockTransferWizardLine } from "~/stores";
import {
  addTransferLine,
  addTransferLines,
  clearStockTransferWizard,
  removeTransferLine,
  setTransferLinesDestination,
  updateTransferLine,
  useStockTransferWizard
} from "~/stores";
import { path } from "~/utils/path";
import { isSameStorageUnit } from "../../inventory.models";
import {
  AssignBatchModal,
  type ExistingBatch
} from "../Inventory/AssignBatchModal";
import type {
  StockFilterDefinition,
  StockFilterOption,
  StockFilterValues
} from "./StockFilters";
import { StockActiveFilters, StockFilter } from "./StockFilters";

// The RPC has no server-side paging, so cap the rows rendered and say so.
const MAX_VISIBLE_ROWS = 250;

/** What `getTrackedStockAtLocation` returns. */
export type TrackedStock = {
  /**
   * What the serial and batch units in a storage unit hold, one row per batch
   * number for a batch item (`batchNumber` null for a serial item).
   */
  stock: {
    itemId: string;
    storageUnitId: string | null;
    batchNumber: string | null;
    expirationDate: string | null;
    quantity: number;
  }[];
  unnumbered: {
    itemId: string;
    storageUnitId: string | null;
    quantity: number;
  }[];
};

type BinRow = {
  itemId: string;
  itemReadableId: string;
  description: string;
  thumbnailPath: string;
  itemTrackingType: string | null;
  itemType: string | null;
  unitOfMeasureCode: string | null;
  quantityOnHand: number;
  // What a transfer can take: all of it, or for a serial or batch item only
  // the units that carry a number. The rest is `quantityUnnumbered`.
  quantityMovable: number;
  quantityUnnumbered: number;
  quantityRequired: number;
  quantityIncoming: number;
  storageUnitId: string | null;
  storageUnitName: string | null;
  isDefaultStorageUnit: boolean;
};

type StockView = "inStock" | "needsStock";
type GroupBy = "bin" | "item";

const isTrackedType = (itemTrackingType: string | null) =>
  itemTrackingType === "Serial" || itemTrackingType === "Batch";

function mapBinRow(
  row: Record<string, any>,
  trackedByBin: Map<string, number>,
  unnumberedByBin: Map<string, number>
): BinRow {
  const quantityOnHand = Number(row.quantityOnHandInStorageUnit ?? 0);
  const key = binKey(row.itemId, row.storageUnitId ?? null);
  const tracked = isTrackedType(row.itemTrackingType ?? null);
  return {
    itemId: row.itemId,
    itemReadableId: row.itemReadableId,
    description: row.description ?? "",
    thumbnailPath: row.thumbnailPath,
    itemTrackingType: row.itemTrackingType ?? null,
    itemType: row.type ?? null,
    unitOfMeasureCode: row.unitOfMeasureCode ?? null,
    quantityOnHand,
    quantityMovable: tracked ? (trackedByBin.get(key) ?? 0) : quantityOnHand,
    quantityUnnumbered: tracked ? (unnumberedByBin.get(key) ?? 0) : 0,
    quantityRequired: Number(row.quantityRequiredByStorageUnit ?? 0),
    quantityIncoming: Number(row.quantityIncoming ?? 0),
    storageUnitId: row.storageUnitId ?? null,
    storageUnitName: row.storageUnitName ?? null,
    isDefaultStorageUnit: row.isDefaultStorageUnit ?? false
  };
}

const EMPTY_QUANTITIES = new Map<string, number>();

const binKey = (itemId: string, storageUnitId: string | null) =>
  `${itemId}:${storageUnitId ?? ""}`;

const EMPTY_BATCHES: ExistingBatch[] = [];

/**
 * One pass over the tracked stock: what each item × bin can move, and each
 * item's batch numbers at the location with what they hold across storage
 * units and the earliest expiry.
 */
export function summarizeTrackedStock(stock: TrackedStock["stock"]) {
  const movableByBin = new Map<string, number>();
  const batchesByNumber = new Map<string, Map<string, ExistingBatch>>();
  for (const row of stock) {
    const key = binKey(row.itemId, row.storageUnitId);
    movableByBin.set(key, round((movableByBin.get(key) ?? 0) + row.quantity));
    if (!row.batchNumber) continue;
    let byNumber = batchesByNumber.get(row.itemId);
    if (!byNumber) {
      byNumber = new Map();
      batchesByNumber.set(row.itemId, byNumber);
    }
    const batch = byNumber.get(row.batchNumber);
    if (!batch) {
      byNumber.set(row.batchNumber, {
        readableId: row.batchNumber,
        quantity: row.quantity,
        expirationDate: row.expirationDate
      });
      continue;
    }
    batch.quantity = round(batch.quantity + row.quantity);
    if (
      row.expirationDate &&
      (!batch.expirationDate || row.expirationDate < batch.expirationDate)
    ) {
      batch.expirationDate = row.expirationDate;
    }
  }
  const batchesByItem = new Map<string, ExistingBatch[]>();
  for (const [itemId, byNumber] of batchesByNumber) {
    batchesByItem.set(
      itemId,
      [...byNumber.values()].sort((a, b) =>
        a.readableId.localeCompare(b.readableId)
      )
    );
  }
  return { movableByBin, batchesByItem };
}

// Stock recorded against the location, not a bin, as a filter option value.
const NO_STORAGE_UNIT = "__none__";

const FILTER_VALUE: Record<string, (row: BinRow) => string> = {
  storageUnit: (row) => row.storageUnitId ?? NO_STORAGE_UNIT,
  itemType: (row) => row.itemType ?? "",
  tracking: (row) => row.itemTrackingType ?? ""
};

function matchesFilters(row: BinRow, values: StockFilterValues) {
  return Object.entries(values).every(
    ([key, selected]) =>
      selected.length === 0 || selected.includes(FILTER_VALUE[key]?.(row) ?? "")
  );
}

/**
 * Distinct values with row counts. A selected value missing from this tab
 * stays listed at 0, labelled from all rows, so its chip never shows a raw id.
 */
function filterOptions(
  rows: BinRow[],
  allRows: BinRow[],
  key: keyof typeof FILTER_VALUE,
  label: (row: BinRow) => string,
  selected: string[] = []
): StockFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const value = FILTER_VALUE[key](row);
    if (!value) continue;
    const entry = counts.get(value) ?? { label: label(row), count: 0 };
    entry.count += 1;
    counts.set(value, entry);
  }
  for (const value of selected) {
    if (counts.has(value)) continue;
    const row = allRows.find((r) => FILTER_VALUE[key](r) === value);
    counts.set(value, { label: row ? label(row) : value, count: 0 });
  }
  return [...counts.entries()]
    .map(([value, { label, count }]) => ({
      value,
      label,
      helper: String(count)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// A bin that needs stock: below zero, or open job demand that what is there
// and what is coming in does not cover.
function needsStock(row: BinRow) {
  return (
    row.quantityOnHand < 0 ||
    row.quantityOnHand + row.quantityIncoming < row.quantityRequired
  );
}

function shortfallOf(row: BinRow) {
  return Math.max(
    0,
    round(row.quantityRequired - row.quantityOnHand - row.quantityIncoming),
    round(-row.quantityOnHand)
  );
}

function lineFromRow(
  row: BinRow
): Pick<
  StockTransferWizardLine,
  | "itemId"
  | "itemReadableId"
  | "description"
  | "thumbnailPath"
  | "unitOfMeasureCode"
  | "requiresSerialTracking"
  | "requiresBatchTracking"
> {
  return {
    itemId: row.itemId,
    itemReadableId: row.itemReadableId,
    description: row.description,
    thumbnailPath: row.thumbnailPath,
    unitOfMeasureCode: row.unitOfMeasureCode,
    requiresSerialTracking: row.itemTrackingType === "Serial",
    requiresBatchTracking: row.itemTrackingType === "Batch"
  };
}

// A serial line splits into one line per unit, so it moves whole units.
function wholeIfSerial(quantity: number, serial: boolean) {
  return serial ? round(quantity, 0, RoundingMode.Down) : quantity;
}

// The loader's data, shared with the line rows so their pickers never fetch.
type BuilderData = {
  storageUnits: StorageUnitTreeRow[];
  rows: BinRow[];
  quantitiesByItem: Map<string, Map<string, number>>;
  batchesByItem: Map<string, ExistingBatch[]>;
};

// So no bin is drawn on for more than it holds across lines.
type Availability = {
  movableByBin: Map<string, number>;
  allocatedByBin: Map<string, number>;
};

const BuilderDataContext = createContext<BuilderData | null>(null);

function useBuilderData() {
  const data = useContext(BuilderDataContext);
  if (!data) throw new Error("useBuilderData needs StockTransferBuilder");
  return data;
}

export function StockTransferBuilder({
  locationId,
  rows: rawRows,
  trackedStock,
  storageUnits
}: {
  locationId: string;
  /** Rows of `get_item_storage_unit_requirements_by_location`. */
  rows: Record<string, any>[];
  trackedStock: TrackedStock;
  storageUnits: StorageUnitTreeRow[];
}) {
  const { isPhone } = useViewport();
  const [wizard] = useStockTransferWizard();

  const tracked = useMemo(
    () => summarizeTrackedStock(trackedStock.stock),
    [trackedStock.stock]
  );

  const rows = useMemo(() => {
    const unnumberedByBin = new Map(
      trackedStock.unnumbered.map((row) => [
        binKey(row.itemId, row.storageUnitId),
        row.quantity
      ])
    );
    return rawRows.map((row) =>
      mapBinRow(row, tracked.movableByBin, unnumberedByBin)
    );
  }, [rawRows, tracked, trackedStock.unnumbered]);

  const data = useMemo<BuilderData>(() => {
    const quantitiesByItem = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!row.storageUnitId || row.quantityMovable === 0) continue;
      const byUnit = quantitiesByItem.get(row.itemId) ?? new Map();
      byUnit.set(row.storageUnitId, row.quantityMovable);
      quantitiesByItem.set(row.itemId, byUnit);
    }
    return {
      storageUnits,
      rows,
      quantitiesByItem,
      batchesByItem: tracked.batchesByItem
    };
  }, [rows, storageUnits, tracked]);

  // What can move per item × bin, and what the lines already take from it.
  const movableByBin = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(binKey(row.itemId, row.storageUnitId), row.quantityMovable);
    }
    return map;
  }, [rows]);

  const allocatedByBin = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of wizard.lines) {
      if (line.needsSource) continue;
      const key = binKey(line.itemId, line.fromStorageUnitId);
      map.set(key, round((map.get(key) ?? 0) + (line.quantity || 0)));
    }
    return map;
  }, [wizard.lines]);

  const availability = useMemo<Availability>(
    () => ({ movableByBin, allocatedByBin }),
    [movableByBin, allocatedByBin]
  );

  const incomingByBin = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of wizard.lines) {
      if (!line.toStorageUnitId) continue;
      const key = binKey(line.itemId, line.toStorageUnitId);
      map.set(key, round((map.get(key) ?? 0) + (line.quantity || 0)));
    }
    return map;
  }, [wizard.lines]);

  return (
    <BuilderDataContext.Provider value={data}>
      <div className="flex flex-1 min-h-0 w-full border-t">
        <ResizablePanelGroup
          direction={isPhone ? "vertical" : "horizontal"}
          className="h-full w-full min-h-0"
        >
          <ResizablePanel
            defaultSize={45}
            minSize={30}
            className="flex flex-col min-h-0 overflow-hidden"
          >
            <StockBrowser
              locationId={locationId}
              rows={rows}
              allocatedByBin={allocatedByBin}
              incomingByBin={incomingByBin}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={55}
            minSize={30}
            className="flex flex-col min-h-0 overflow-hidden"
          >
            <TransferLines
              locationId={locationId}
              lines={wizard.lines}
              availability={availability}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <WizardFooter
        locationId={locationId}
        lines={wizard.lines}
        availability={availability}
      />
    </BuilderDataContext.Provider>
  );
}

function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center size-5 rounded-full text-[0.6875rem] font-semibold flex-shrink-0",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {step}
    </span>
  );
}

function binLabel(name: string | null, unassigned: string) {
  return name?.trim() ? name : unassigned;
}

function StockBrowser({
  locationId,
  rows,
  allocatedByBin,
  incomingByBin
}: {
  locationId: string;
  rows: BinRow[];
  allocatedByBin: Map<string, number>;
  incomingByBin: Map<string, number>;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<StockView>("inStock");
  const [groupBy, setGroupBy] = useState<GroupBy>("bin");
  const [filterValues, setFilterValues] = useState<StockFilterValues>({});
  const [assignBatchRow, setAssignBatchRow] = useState<BinRow | null>(null);
  const { batchesByItem } = useBuilderData();

  // A serial or batch row is in stock when it holds a unit, or stock with no
  // number to fix; its on-hand also counts transfers on their way in.
  const allInStockRows = useMemo(
    () =>
      rows.filter((row) =>
        row.itemTrackingType === "Serial" || row.itemTrackingType === "Batch"
          ? row.quantityMovable > 0 || row.quantityUnnumbered > 0
          : row.quantityOnHand > 0
      ),
    [rows]
  );
  const allNeedsStockRows = useMemo(() => rows.filter(needsStock), [rows]);

  // Options come from the rows of the current tab, so every option matches
  // something; the counts on the tabs follow the filters.
  const filters = useMemo<StockFilterDefinition[]>(() => {
    const source = view === "inStock" ? allInStockRows : allNeedsStockRows;
    return [
      {
        key: "storageUnit",
        header: t`Storage Unit`,
        icon: <LuWarehouse />,
        options: filterOptions(
          source,
          rows,
          "storageUnit",
          (row) => binLabel(row.storageUnitName, t`No storage unit`),
          filterValues.storageUnit
        )
      },
      {
        key: "itemType",
        header: t`Item Type`,
        icon: <LuShapes />,
        options: filterOptions(
          source,
          rows,
          "itemType",
          (row) => row.itemType ?? "",
          filterValues.itemType
        )
      },
      {
        key: "tracking",
        header: t`Tracking`,
        icon: <LuQrCode />,
        options: filterOptions(
          source,
          rows,
          "tracking",
          (row) => row.itemTrackingType ?? "",
          filterValues.tracking
        )
      }
    ];
  }, [view, rows, allInStockRows, allNeedsStockRows, filterValues, t]);

  const isFiltered = Object.keys(filterValues).length > 0;
  const inStockRows = useMemo(
    () => allInStockRows.filter((row) => matchesFilters(row, filterValues)),
    [allInStockRows, filterValues]
  );
  const needsStockRows = useMemo(
    () => allNeedsStockRows.filter((row) => matchesFilters(row, filterValues)),
    [allNeedsStockRows, filterValues]
  );

  const filtered = useMemo(() => {
    const source = view === "inStock" ? inStockRows : needsStockRows;
    const term = search.trim().toLowerCase();
    if (!term) return source;
    return source.filter(
      (row) =>
        row.itemReadableId.toLowerCase().includes(term) ||
        row.description.toLowerCase().includes(term) ||
        (row.storageUnitName ?? "").toLowerCase().includes(term)
    );
  }, [view, inStockRows, needsStockRows, search]);

  const visible = useMemo(
    () => filtered.slice(0, MAX_VISIBLE_ROWS),
    [filtered]
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; rows: BinRow[] }
    >();
    for (const row of visible) {
      const key = groupBy === "bin" ? (row.storageUnitId ?? "") : row.itemId;
      const label =
        groupBy === "bin"
          ? binLabel(row.storageUnitName, t`No storage unit`)
          : row.itemReadableId;
      const group = map.get(key) ?? { key, label, rows: [] };
      group.rows.push(row);
      map.set(key, group);
    }
    const list = [...map.values()];
    if (groupBy === "bin") {
      // Stock with no storage unit goes last.
      list.sort((a, b) =>
        !a.key || !b.key
          ? a.key
            ? -1
            : b.key
              ? 1
              : 0
          : a.label.localeCompare(b.label)
      );
    } else {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return list;
  }, [visible, groupBy, t]);

  // What a row can still move, in whole units for a serial item.
  const remainingOf = useCallback(
    (row: BinRow) =>
      wholeIfSerial(
        Math.max(
          0,
          round(
            row.quantityMovable -
              (allocatedByBin.get(binKey(row.itemId, row.storageUnitId)) ?? 0)
          )
        ),
        row.itemTrackingType === "Serial"
      ),
    [allocatedByBin]
  );

  const moveRow = (row: BinRow, quantity: number) => {
    if (quantity <= 0) return;
    addTransferLine({
      ...lineFromRow(row),
      fromStorageUnitId: row.storageUnitId,
      fromStorageUnitName: row.storageUnitName,
      needsSource: false,
      toStorageUnitId: null,
      toStorageUnitName: null,
      quantityAvailable: row.quantityMovable,
      quantity
    });
  };

  const moveAll = (groupRows: BinRow[]) => {
    addTransferLines(
      groupRows
        .map((row) => ({ row, remaining: remainingOf(row) }))
        .filter(({ remaining }) => remaining > 0)
        .map(({ row, remaining }) => ({
          ...lineFromRow(row),
          fromStorageUnitId: row.storageUnitId,
          fromStorageUnitName: row.storageUnitName,
          needsSource: false,
          toStorageUnitId: null,
          toStorageUnitName: null,
          quantityAvailable: row.quantityMovable,
          quantity: remaining
        }))
    );
  };

  // What the bin still lacks after the lines already headed to it.
  const unfilledOf = (row: BinRow) =>
    round(
      shortfallOf(row) -
        (incomingByBin.get(binKey(row.itemId, row.storageUnitId)) ?? 0)
    );

  const fillRow = (row: BinRow) => {
    const quantity = wholeIfSerial(
      unfilledOf(row),
      row.itemTrackingType === "Serial"
    );
    if (quantity <= 0) return;
    addTransferLine({
      ...lineFromRow(row),
      fromStorageUnitId: null,
      fromStorageUnitName: null,
      needsSource: true,
      toStorageUnitId: row.storageUnitId,
      toStorageUnitName: row.storageUnitName,
      quantityAvailable: 0,
      quantity
    });
  };

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <HStack
        spacing={2}
        className="h-14 px-4 border-b w-full flex-shrink-0 items-center"
      >
        <StepBadge step={1} active />
        <span className="text-sm font-medium">
          <Trans>Choose stock to move</Trans>
        </span>
      </HStack>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b w-full flex-shrink-0">
        <InputGroup size="sm" className="flex-1 min-w-[160px]">
          <InputLeftElement>
            <LuSearch className="text-muted-foreground w-3.5 h-3.5" />
          </InputLeftElement>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t`Search items or storage units`}
            aria-label={t`Search items or storage units`}
            className="text-sm"
          />
        </InputGroup>
        <StockFilter
          filters={filters}
          values={filterValues}
          onChange={setFilterValues}
        />
        <HStack spacing={1}>
          <Button
            size="sm"
            variant={groupBy === "bin" ? "secondary" : "ghost"}
            onClick={() => setGroupBy("bin")}
          >
            <Trans>By storage unit</Trans>
          </Button>
          <Button
            size="sm"
            variant={groupBy === "item" ? "secondary" : "ghost"}
            onClick={() => setGroupBy("item")}
          >
            <Trans>By item</Trans>
          </Button>
        </HStack>
      </div>
      {isFiltered && (
        <div className="px-4 py-2 border-b w-full flex-shrink-0">
          <StockActiveFilters
            filters={filters}
            values={filterValues}
            onChange={setFilterValues}
          />
        </div>
      )}
      <HStack
        spacing={2}
        className="px-4 py-2 border-b w-full flex-shrink-0 flex-wrap"
      >
        <Button
          size="sm"
          variant={view === "inStock" ? "primary" : "secondary"}
          onClick={() => setView("inStock")}
        >
          <Trans>In stock</Trans>
          <span className="ml-1 tabular-nums opacity-70">
            {inStockRows.length}
          </span>
        </Button>
        <Button
          size="sm"
          variant={view === "needsStock" ? "primary" : "secondary"}
          onClick={() => setView("needsStock")}
        >
          <Trans>Needs stock</Trans>
          <span className="ml-1 tabular-nums opacity-70">
            {needsStockRows.length}
          </span>
        </Button>
      </HStack>

      <div className="flex-1 min-h-0 w-full max-md:overflow-y-auto">
        {groups.length === 0 ? (
          <WizardEmptyState
            icon={<LuPackageSearch className="h-6 w-6 flex-shrink-0" />}
            title={
              search.trim() || isFiltered
                ? t`No matches`
                : view === "inStock"
                  ? t`No stock at this location`
                  : t`Nothing needs stock`
            }
            hint={
              search.trim()
                ? t`Nothing here matches "${search.trim()}".`
                : isFiltered
                  ? t`Nothing here matches the filters.`
                  : view === "inStock"
                    ? t`No storage unit at this location holds any stock.`
                    : t`No storage unit is short for open jobs or below zero.`
            }
            action={
              search.trim() || isFiltered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setFilterValues({});
                  }}
                >
                  {isFiltered ? (
                    <Trans>Clear search and filters</Trans>
                  ) : (
                    <Trans>Clear search</Trans>
                  )}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ScrollArea className="h-full w-full">
            {groups.map((group) => {
              const movable = group.rows.filter((row) => remainingOf(row) > 0);
              return (
                <div key={group.key || "none"}>
                  <div className="flex h-9 items-center justify-between gap-2 px-4 border-b bg-muted/40">
                    <span
                      className={cn(
                        "text-xs font-medium truncate",
                        groupBy === "bin" &&
                          !group.key &&
                          "italic text-muted-foreground"
                      )}
                    >
                      {group.label}
                    </span>
                    {view === "inStock" &&
                      groupBy === "bin" &&
                      movable.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          rightIcon={<LuArrowRight />}
                          onClick={() => moveAll(movable)}
                        >
                          <Plural
                            value={movable.length}
                            one="Move # item"
                            other="Move all # items"
                          />
                        </Button>
                      )}
                  </div>
                  {group.rows.map((row) => (
                    <StockRow
                      key={binKey(row.itemId, row.storageUnitId)}
                      row={row}
                      view={view}
                      groupBy={groupBy}
                      allocated={
                        allocatedByBin.get(
                          binKey(row.itemId, row.storageUnitId)
                        ) ?? 0
                      }
                      incoming={
                        incomingByBin.get(
                          binKey(row.itemId, row.storageUnitId)
                        ) ?? 0
                      }
                      remaining={remainingOf(row)}
                      formatQuantity={formatQuantity}
                      onMove={() => moveRow(row, remainingOf(row))}
                      onFill={() => fillRow(row)}
                      onAssignBatch={() => setAssignBatchRow(row)}
                    />
                  ))}
                </div>
              );
            })}
            {filtered.length > visible.length && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                <Trans>
                  Showing {visible.length} of {filtered.length}. Search to
                  narrow it down.
                </Trans>
              </p>
            )}
          </ScrollArea>
        )}
      </div>
      {assignBatchRow && (
        <AssignBatchModal
          itemId={assignBatchRow.itemId}
          itemReadableId={assignBatchRow.itemReadableId}
          locationId={locationId}
          storageUnitId={assignBatchRow.storageUnitId}
          quantity={assignBatchRow.quantityUnnumbered}
          batches={batchesByItem.get(assignBatchRow.itemId) ?? EMPTY_BATCHES}
          onClose={() => setAssignBatchRow(null)}
        />
      )}
    </VStack>
  );
}

function StockRow({
  row,
  view,
  groupBy,
  allocated,
  incoming,
  remaining,
  formatQuantity,
  onMove,
  onFill,
  onAssignBatch
}: {
  row: BinRow;
  view: StockView;
  groupBy: GroupBy;
  allocated: number;
  incoming: number;
  remaining: number;
  formatQuantity: (quantity: number) => string;
  onMove: () => void;
  onFill: () => void;
  onAssignBatch: () => void;
}) {
  const { t } = useLingui();
  const shortfall = shortfallOf(row);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b hover:bg-muted/40">
      {groupBy === "bin" ? (
        <>
          <ItemThumbnail thumbnailPath={row.thumbnailPath} type="Part" />
          <VStack spacing={0} className="flex-1 min-w-0">
            <span className="w-full text-sm font-medium truncate">
              {row.itemReadableId}
              {row.itemTrackingType && row.itemTrackingType !== "Inventory" && (
                <Badge variant="secondary" className="ml-2">
                  {row.itemTrackingType}
                </Badge>
              )}
            </span>
            <span className="w-full text-xs text-muted-foreground truncate">
              {row.description}
            </span>
          </VStack>
        </>
      ) : (
        <VStack spacing={0} className="flex-1 min-w-0">
          <span
            className={cn(
              "w-full text-sm font-medium truncate",
              !row.storageUnitName && "italic text-muted-foreground"
            )}
          >
            {binLabel(row.storageUnitName, t`No storage unit`)}
            {row.isDefaultStorageUnit && (
              <Badge variant="secondary" className="ml-2">
                <Trans>Default</Trans>
              </Badge>
            )}
          </span>
          {view === "needsStock" && row.quantityRequired > 0 && (
            <span className="w-full text-xs text-muted-foreground truncate">
              <Trans>
                {formatQuantity(row.quantityRequired)} needed for jobs
              </Trans>
            </span>
          )}
        </VStack>
      )}

      {view === "inStock" ? (
        <>
          <VStack spacing={0} className="w-auto items-end shrink-0">
            <span className="text-sm font-medium tabular-nums">
              {formatQuantity(row.quantityMovable)}
            </span>
            {allocated > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                <Trans>{formatQuantity(allocated)} moving</Trans>
              </span>
            )}
            {row.quantityUnnumbered > 0 && (
              <UnnumberedStock
                row={row}
                formatQuantity={formatQuantity}
                onAssignBatch={onAssignBatch}
              />
            )}
          </VStack>
          <Button
            size="sm"
            variant="secondary"
            rightIcon={<LuArrowRight />}
            isDisabled={remaining <= 0}
            onClick={onMove}
          >
            <Trans>Move</Trans>
          </Button>
        </>
      ) : (
        <>
          <VStack spacing={0} className="w-auto items-end shrink-0">
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                row.quantityOnHand < 0 && "text-destructive"
              )}
            >
              {formatQuantity(row.quantityOnHand)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {incoming > 0 ? (
                <Trans>{formatQuantity(incoming)} coming</Trans>
              ) : (
                <Trans>short {formatQuantity(shortfall)}</Trans>
              )}
            </span>
          </VStack>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<LuArrowLeft />}
            isDisabled={
              wholeIfSerial(
                round(shortfall - incoming),
                row.itemTrackingType === "Serial"
              ) <= 0
            }
            onClick={onFill}
          >
            <Trans>Fill</Trans>
          </Button>
        </>
      )}
    </div>
  );
}

// Serial or batch stock with no number, which no transfer can pick.
function UnnumberedStock({
  row,
  formatQuantity,
  onAssignBatch
}: {
  row: BinRow;
  formatQuantity: (quantity: number) => string;
  onAssignBatch: () => void;
}) {
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const isSerial = row.itemTrackingType === "Serial";
  const quantity = formatQuantity(row.quantityUnnumbered);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs tabular-nums whitespace-nowrap text-amber-600 dark:text-amber-400 underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          <LuTriangleAlert className="size-3 shrink-0" />
          {isSerial ? (
            <Trans>{quantity} without a serial number</Trans>
          ) : (
            <Trans>{quantity} without a batch</Trans>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <VStack spacing={3}>
          <p className="text-sm">
            {isSerial ? (
              <Trans>
                These have no serial number, so a transfer can't pick them. Give
                each one a serial number to move it.
              </Trans>
            ) : (
              <Trans>
                These have no batch number, so a transfer can't pick them. Give
                them a batch to move them.
              </Trans>
            )}
          </p>
          {isSerial ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to={path.to.inventoryItem(row.itemId)}>
                <Trans>Open Item Stock</Trans>
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              isDisabled={!permissions.can("update", "inventory")}
              onClick={() => {
                setOpen(false);
                onAssignBatch();
              }}
            >
              <Trans>Assign a Batch</Trans>
            </Button>
          )}
        </VStack>
      </PopoverContent>
    </Popover>
  );
}

function WizardEmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <VStack
      spacing={4}
      className="w-full items-center justify-center py-16 px-6 text-center max-md:py-3 max-md:gap-2"
    >
      <div className="flex justify-center items-center h-12 w-12 rounded-full bg-muted text-muted-foreground max-md:hidden">
        {icon}
      </div>
      <span className="text-xs font-mono font-light text-foreground uppercase">
        {title}
      </span>
      {hint && (
        <span className="text-xs text-muted-foreground max-w-[32ch]">
          {hint}
        </span>
      )}
      {action}
    </VStack>
  );
}

type LineIssue = "source" | "destination" | "same" | "quantity" | "overdraw";

const lineElementId = (key: string) => `stock-transfer-line-${key}`;

// Shows which line a "needs attention" entry meant.
function revealLine(key: string) {
  const element = document.getElementById(lineElementId(key));
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("ring-2", "ring-destructive");
  window.setTimeout(
    () => element.classList.remove("ring-2", "ring-destructive"),
    1600
  );
}

/** What still stops a line from being created, or null when it is ready. */
function lineIssues(
  line: StockTransferWizardLine,
  available: number
): LineIssue[] {
  const issues: LineIssue[] = [];
  if (line.needsSource) issues.push("source");
  if (!line.toStorageUnitId) issues.push("destination");
  else if (
    !line.needsSource &&
    isSameStorageUnit(line.fromStorageUnitId, line.toStorageUnitId)
  ) {
    issues.push("same");
  }
  if (!(line.quantity > 0)) issues.push("quantity");
  else if (!line.needsSource && line.quantity > available) {
    issues.push("overdraw");
  }
  return issues;
}

/** What a line may take from its bin, less what the other lines take. */
function availableFor(
  line: StockTransferWizardLine,
  availability: Availability
) {
  if (line.needsSource) return 0;
  const key = binKey(line.itemId, line.fromStorageUnitId);
  const movable = availability.movableByBin.get(key) ?? line.quantityAvailable;
  const others = round(
    (availability.allocatedByBin.get(key) ?? 0) - (line.quantity || 0)
  );
  return Math.max(0, round(movable - others));
}

/** Why a line asks for more than it can take, in the line's own terms. */
function useOverdrawMessage() {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  return (line: StockTransferWizardLine, available: number) => {
    const quantity = formatQuantity(available);
    if (line.requiresSerialTracking) {
      return t`Only ${quantity} with a serial number there`;
    }
    if (line.requiresBatchTracking) return t`Only ${quantity} in batches there`;
    return t`Only ${quantity} there`;
  };
}

function TransferLines({
  locationId,
  lines,
  availability
}: {
  locationId: string;
  lines: StockTransferWizardLine[];
  availability: Availability;
}) {
  const { storageUnits } = useBuilderData();
  const { t } = useLingui();
  // Fill lines keep their To. Send all to shows the To the other lines
  // share, and has nothing to do until one differs.
  const sendable = lines.filter((line) => !line.needsSource);
  const commonDestination =
    sendable.length > 0 &&
    sendable[0].toStorageUnitId !== null &&
    sendable.every(
      (line) => line.toStorageUnitId === sendable[0].toStorageUnitId
    )
      ? sendable[0].toStorageUnitId
      : null;

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <div className="flex h-14 items-center gap-2 px-4 border-b w-full flex-shrink-0">
        <StepBadge step={2} active={lines.length > 0} />
        <span className="text-sm font-medium">
          <Trans>Choose where it goes</Trans>
        </span>
        {sendable.length > 0 && (
          <HStack spacing={2} className="ml-auto items-center">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              <Trans>Send all to</Trans>
            </span>
            <div className="w-48">
              <StorageUnit
                locationId={locationId}
                storageUnits={storageUnits}
                value={commonDestination}
                placeholder={t`Storage unit`}
                disabled={commonDestination !== null}
                onChange={(storageUnit) => {
                  if (!storageUnit) return;
                  const changed = setTransferLinesDestination(
                    storageUnit.id,
                    storageUnit.name
                  );
                  if (changed === 0) {
                    toast.info(
                      t`Every line already comes from ${storageUnit.name}`
                    );
                  }
                }}
              />
            </div>
          </HStack>
        )}
      </div>
      <div className="flex-1 min-h-0 w-full">
        {lines.length === 0 ? (
          <WizardEmptyState
            icon={<LuMousePointerClick className="h-6 w-6 flex-shrink-0" />}
            title={t`No lines yet`}
            hint={t`Choose Move on the stock to send somewhere else, or Fill on a storage unit that needs stock.`}
          />
        ) : (
          <ScrollArea className="h-full w-full">
            <div className="p-4 flex flex-col gap-2">
              {lines.map((line) => (
                <TransferLineRow
                  key={line.key}
                  line={line}
                  locationId={locationId}
                  available={availableFor(line, availability)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </VStack>
  );
}

function TransferLineRow({
  line,
  locationId,
  available
}: {
  line: StockTransferWizardLine;
  locationId: string;
  available: number;
}) {
  const { storageUnits, quantitiesByItem } = useBuilderData();
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const overdrawMessage = useOverdrawMessage();
  const issues = lineIssues(line, available);
  const fromName = binLabel(line.fromStorageUnitName, t`No storage unit`);
  const isSerial = line.requiresSerialTracking;

  return (
    <div
      id={lineElementId(line.key)}
      className="@container rounded-lg border p-3 transition-shadow"
    >
      <div className="flex items-start gap-3">
        <ItemThumbnail thumbnailPath={line.thumbnailPath} type="Part" />
        <div className="flex-1 min-w-0 grid gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_7rem] @xl:items-start">
          <VStack spacing={0} className="min-w-0">
            <span className="w-full text-sm font-medium truncate">
              {line.itemReadableId}
              {(line.requiresSerialTracking || line.requiresBatchTracking) && (
                <Badge variant="secondary" className="ml-2">
                  {line.requiresSerialTracking ? t`Serial` : t`Batch`}
                </Badge>
              )}
            </span>
            <span className="w-full text-xs text-muted-foreground truncate">
              {line.description}
            </span>
          </VStack>

          <VStack spacing={1} className="min-w-0">
            <span className="text-xs text-muted-foreground">
              <Trans>From</Trans>
            </span>
            {/* Stock recorded against the location, not a storage unit, is
                not an option in the picker, so that source stays as text. */}
            {line.needsSource || line.fromStorageUnitId !== null ? (
              <SourcePicker line={line} locationId={locationId} />
            ) : (
              <>
                <span
                  className={cn(
                    "w-full text-sm truncate",
                    !line.fromStorageUnitName && "italic text-muted-foreground"
                  )}
                >
                  {fromName}
                </span>
              </>
            )}
          </VStack>

          <VStack spacing={1} className="min-w-0">
            <span className="text-xs text-muted-foreground">
              <Trans>To</Trans>
            </span>
            <div className="w-full">
              <StorageUnit
                locationId={locationId}
                itemId={line.itemId}
                storageUnits={storageUnits}
                quantities={
                  quantitiesByItem.get(line.itemId) ?? EMPTY_QUANTITIES
                }
                value={line.toStorageUnitId}
                stockedFirst
                excludeId={line.needsSource ? null : line.fromStorageUnitId}
                placeholder={t`Storage unit`}
                onChange={(storageUnit) =>
                  updateTransferLine(line.key, {
                    toStorageUnitId: storageUnit?.id ?? null,
                    toStorageUnitName: storageUnit?.name ?? null
                  })
                }
              />
            </div>
            {issues.includes("same") && (
              <span className="text-xs text-destructive">
                <Trans>From and To can't be the same storage unit</Trans>
              </span>
            )}
          </VStack>

          <VStack spacing={1} className="min-w-0">
            <span className="text-xs text-muted-foreground">
              <Trans>Quantity</Trans>
            </span>
            <NumberField
              value={line.quantity}
              minValue={0}
              step={isSerial ? 1 : INPUT_STEP.quantity}
              formatOptions={INPUT_FORMAT.quantity}
              aria-label={t`Quantity`}
              onChange={(value: number) =>
                updateTransferLine(line.key, {
                  quantity: Number.isFinite(value) ? value : 0
                })
              }
            >
              <NumberInputGroup>
                <NumberInput
                  size="sm"
                  className={cn(
                    (issues.includes("quantity") ||
                      issues.includes("overdraw")) &&
                      "border-destructive"
                  )}
                />
              </NumberInputGroup>
            </NumberField>
            {!line.needsSource && (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  issues.includes("overdraw")
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {issues.includes("overdraw") ? (
                  overdrawMessage(line, available)
                ) : (
                  <Trans>of {formatQuantity(available)}</Trans>
                )}
                {!issues.includes("overdraw") &&
                  line.quantity !== available && (
                    <button
                      type="button"
                      className="ml-1 underline underline-offset-2 hover:text-foreground"
                      onClick={() =>
                        updateTransferLine(line.key, {
                          quantity: isSerial
                            ? round(available, 0, RoundingMode.Down)
                            : available
                        })
                      }
                    >
                      <Trans>All</Trans>
                    </button>
                  )}
              </span>
            )}
          </VStack>
        </div>
        <IconButton
          aria-label={t`Remove line`}
          variant="ghost"
          size="sm"
          icon={<LuTrash2 />}
          onClick={() => removeTransferLine(line.key)}
        />
      </div>
    </div>
  );
}

function SourcePicker({
  line,
  locationId
}: {
  line: StockTransferWizardLine;
  locationId: string;
}) {
  const { t } = useLingui();
  const { storageUnits, quantitiesByItem } = useBuilderData();
  const quantities = quantitiesByItem.get(line.itemId) ?? EMPTY_QUANTITIES;

  return (
    <div className="w-full">
      <StorageUnit
        locationId={locationId}
        itemId={line.itemId}
        storageUnits={storageUnits}
        quantities={quantities}
        value={line.needsSource ? null : line.fromStorageUnitId}
        stockedFirst
        stockedOnly
        excludeId={line.toStorageUnitId}
        allowCreate={false}
        placeholder={t`Storage unit`}
        onChange={(storageUnit) => {
          if (!storageUnit) {
            updateTransferLine(line.key, {
              fromStorageUnitId: null,
              fromStorageUnitName: null,
              needsSource: true
            });
            return;
          }
          const available = quantities.get(storageUnit.id) ?? 0;
          updateTransferLine(line.key, {
            fromStorageUnitId: storageUnit.id,
            fromStorageUnitName: storageUnit.name,
            needsSource: false,
            quantityAvailable: available,
            // Keep what the line asks for when the unit is empty, so the
            // line says how much is there instead of asking for a quantity.
            quantity:
              available > 0
                ? Math.min(line.quantity || available, available)
                : line.quantity
          });
        }}
      />
    </div>
  );
}

function LineIssuesPopover({
  issueLines
}: {
  issueLines: {
    line: StockTransferWizardLine;
    issues: LineIssue[];
    available: number;
  }[];
}) {
  const { t } = useLingui();
  const overdrawMessage = useOverdrawMessage();
  const [open, setOpen] = useState(false);

  const reason = (
    line: StockTransferWizardLine,
    issue: LineIssue,
    available: number
  ) => {
    switch (issue) {
      case "source":
        return t`Choose where it comes from`;
      case "destination":
        return t`Choose where it goes`;
      case "same":
        return t`From and To are the same storage unit`;
      case "quantity":
        return t`Enter a quantity`;
      case "overdraw":
        return overdrawMessage(line, available);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-destructive underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          <Plural
            value={issueLines.length}
            one="# needs attention"
            other="# need attention"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[340px] p-1">
        <ScrollArea className="max-h-[40dvh] w-full">
          <VStack spacing={0}>
            {issueLines.map(({ line, issues, available }) => (
              <button
                key={line.key}
                type="button"
                className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted/60"
                onClick={() => {
                  setOpen(false);
                  revealLine(line.key);
                }}
              >
                <span aria-hidden className="shrink-0">
                  <ItemThumbnail
                    thumbnailPath={line.thumbnailPath}
                    type="Part"
                    size="sm"
                  />
                </span>
                <VStack spacing={0} className="flex-1 min-w-0">
                  <span className="w-full truncate text-sm font-medium">
                    {line.itemReadableId}{" "}
                    {!line.needsSource ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        <Trans>
                          from{" "}
                          {binLabel(
                            line.fromStorageUnitName,
                            t`No storage unit`
                          )}
                        </Trans>
                      </span>
                    ) : line.toStorageUnitId ? (
                      // A Fill line has no source yet: name where it goes.
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        <Trans>
                          to{" "}
                          {binLabel(line.toStorageUnitName, t`No storage unit`)}
                        </Trans>
                      </span>
                    ) : null}
                  </span>
                  <span className="w-full truncate text-xs text-destructive">
                    {issues
                      .map((issue) => reason(line, issue, available))
                      .join(" · ")}
                  </span>
                </VStack>
              </button>
            ))}
          </VStack>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function WizardFooter({
  locationId,
  lines,
  availability
}: {
  locationId: string;
  lines: StockTransferWizardLine[];
  availability: Availability;
}) {
  const { isPhone } = useViewport();
  const formatQuantity = useQuantityFormatter();

  // Storage rules run on create (the transfer is created Released); the modal
  // shows the violations before anything exists.
  const createRules = useRuleViolations<Result>({
    action: path.to.newStockTransfer,
    onSuccess: () => clearStockTransferWizard()
  });
  const fetcher = createRules.fetcher;

  const issueLines = lines.flatMap((line) => {
    const available = availableFor(line, availability);
    const issues = lineIssues(line, available);
    return issues.length > 0 ? [{ line, issues, available }] : [];
  });
  const issues = issueLines.length;
  const totalQuantity = round(
    lines.reduce((sum, line) => sum + (line.quantity || 0), 0)
  );
  const canSubmit = lines.length > 0 && issues === 0;
  const isSubmitting = fetcher.state !== "idle";

  const submit = () => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set(
      "lines",
      JSON.stringify(
        lines.map((line) => ({
          itemId: line.itemId,
          fromStorageUnitId: line.fromStorageUnitId,
          toStorageUnitId: line.toStorageUnitId,
          quantity: line.quantity,
          requiresSerialTracking: line.requiresSerialTracking,
          requiresBatchTracking: line.requiresBatchTracking
        }))
      )
    );
    createRules.submit(fd);
  };

  const content = (
    <>
      <VStack spacing={0} className="w-auto min-w-0">
        <span className="text-sm text-muted-foreground tabular-nums">
          {lines.length === 0 ? (
            <Trans>No lines yet</Trans>
          ) : (
            <>
              <Plural value={lines.length} one="# line" other="# lines" />
              {" · "}
              <Trans>{formatQuantity(totalQuantity)} units</Trans>
              {issues > 0 && (
                <>
                  {" · "}
                  <LineIssuesPopover issueLines={issueLines} />
                </>
              )}
            </>
          )}
        </span>
      </VStack>

      <HStack spacing={2} className="w-full sm:w-auto justify-end">
        <Button
          variant="ghost"
          isDisabled={lines.length === 0 || isSubmitting}
          onClick={clearStockTransferWizard}
        >
          <Trans>Clear</Trans>
        </Button>
        <Button
          isLoading={isSubmitting}
          isDisabled={!canSubmit || isSubmitting}
          onClick={submit}
        >
          <Trans>Create Transfer</Trans>
        </Button>
      </HStack>
    </>
  );

  return (
    <>
      {isPhone ? (
        // In place of the dock, which would cover a footer at the page end.
        <PhoneActionBar className="flex-col items-stretch">
          {content}
        </PhoneActionBar>
      ) : (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t bg-card px-4 py-3">
          {content}
        </div>
      )}
      <createRules.ViolationModal />
    </>
  );
}
