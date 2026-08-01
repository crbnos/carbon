import type { Result } from "@carbon/auth";
import { useCarbon } from "@carbon/auth";
import { useStorageRuleViolations } from "@carbon/ee/storage-rules";
import { getLogger } from "@carbon/logger";
import {
  Badge,
  Button,
  Count,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
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
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useMount,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowRight,
  LuFlag,
  LuInfo,
  LuMousePointerClick,
  LuPackageSearch,
  LuSearch,
  LuTrash2
} from "react-icons/lu";
import { ItemThumbnail, Table } from "~/components";
import { useUser } from "~/hooks";
import type { StockTransferSource, StockTransferWizardLine } from "~/stores";
import {
  addTransferLine,
  clearStockTransferWizard,
  clearTransferLines,
  removeTransferLine,
  setActiveSource,
  updateTransferLineQuantity,
  useStockTransferWizard,
  useStockTransferWizardLinesCount,
  useStockTransferWizardTotalQuantity
} from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "stocktransferwizard");

// The RPC returns every item×bin with activity at the location. There's no
// server-side paging and the shared Table doesn't virtualize, so cap the DOM
// and say so when the list is truncated.
const MAX_VISIBLE_SOURCES = 250;

// Panes read left-to-right in the direction stock moves: pick the bin you're
// pulling from (1), then the bins it goes to (2).
function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center size-5 rounded-full text-[11px] font-semibold flex-shrink-0",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {step}
    </span>
  );
}

// Ledger rows can carry a null storageUnitId (stock recorded against the
// location, not a bin). Those are real, transferable rows — label them rather
// than rendering a blank cell.
function binLabel(name: string | null, unassigned: string) {
  return name?.trim() ? name : unassigned;
}

export function StockTransferWizard({
  locationId,
  onClose
}: {
  locationId: string;
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader className="px-4 flex-shrink-0">
          <DrawerTitle>
            <Trans>Stock Transfer Wizard</Trans>
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            <Trans>
              Pick the bin stock is coming from, then pick the bins it goes to.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <TransferGrid locationId={locationId} />
      </DrawerContent>
    </Drawer>
  );
}

type BinRow = {
  itemId: string;
  itemReadableId: string;
  description: string;
  thumbnailPath: string;
  itemTrackingType: string | null;
  unitOfMeasureCode: string | null;
  quantityOnHand: number;
  quantityRequired: number;
  quantityAvailable: number;
  quantityIncoming: number;
  storageUnitId: string | null;
  storageUnitName: string | null;
  isDefaultStorageUnit: boolean;
};

// Both requirements RPCs share a row shape, so both panes map it the same way.
// Note `quantityAvailable` is derived here — the RPC doesn't return it.
function mapBinRow(row: Record<string, any>): BinRow {
  return {
    itemId: row.itemId,
    itemReadableId: row.itemReadableId,
    description: row.description,
    thumbnailPath: row.thumbnailPath,
    itemTrackingType: row.itemTrackingType ?? null,
    unitOfMeasureCode: row.unitOfMeasureCode ?? null,
    quantityOnHand: row.quantityOnHandInStorageUnit,
    quantityRequired: row.quantityRequiredByStorageUnit,
    quantityAvailable:
      row.quantityOnHandInStorageUnit - row.quantityRequiredByStorageUnit,
    quantityIncoming: row.quantityIncoming,
    storageUnitId: row.storageUnitId,
    storageUnitName: row.storageUnitName,
    isDefaultStorageUnit: row.isDefaultStorageUnit ?? false
  };
}

function TransferGrid({ locationId }: { locationId: string }) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const [wizard] = useStockTransferWizard();
  const activeSource = wizard.activeSource;

  const [sourceBins, setSourceBins] = useState<BinRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [destinationBins, setDestinationBins] = useState<BinRow[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);

  useMount(() => {
    const load = async () => {
      if (!carbon) return;
      setSourcesLoading(true);
      const { data, error } = await carbon.rpc(
        "get_item_storage_unit_requirements_by_location",
        { company_id: companyId, location_id: locationId }
      );
      if (error) {
        toast.error(error.message);
        setSourceBins([]);
      } else {
        setSourceBins((data ?? []).map(mapBinRow));
      }
      setSourcesLoading(false);
    };
    load();
  });

  // Destinations are scoped to the active source's item. One call, not N.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!carbon || !activeSource) {
        setDestinationBins([]);
        return;
      }
      setDestinationsLoading(true);
      const { data, error } = await carbon.rpc(
        "get_item_storage_unit_requirements_by_location_and_item",
        {
          company_id: companyId,
          location_id: locationId,
          item_id: activeSource.itemId
        }
      );
      if (cancelled) return;
      if (error) {
        logger.error(error);
        toast.error(error.message);
        setDestinationBins([]);
      } else {
        // The RPC returns every bin for the item, including the source itself.
        setDestinationBins(
          (data ?? [])
            .map(mapBinRow)
            .filter((bin) => bin.storageUnitId !== activeSource.storageUnitId)
        );
      }
      setDestinationsLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [carbon, companyId, locationId, activeSource]);

  const filteredSources = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = term
      ? sourceBins.filter(
          (row) =>
            row.itemReadableId.toLowerCase().includes(term) ||
            (row.description ?? "").toLowerCase().includes(term) ||
            (row.storageUnitName ?? "").toLowerCase().includes(term)
        )
      : sourceBins;
    // The RPC orders neediest-first, which suited a destination picker. As a
    // source picker, the bins worth pulling from are the ones with stock.
    return [...rows].sort((a, b) => b.quantityAvailable - a.quantityAvailable);
  }, [sourceBins, search]);

  const visibleSources = useMemo(
    () => filteredSources.slice(0, MAX_VISIBLE_SOURCES),
    [filteredSources]
  );

  const activeSourceRow = useMemo(
    () =>
      sourceBins.find(
        (row) =>
          row.itemId === activeSource?.itemId &&
          row.storageUnitId === activeSource?.storageUnitId
      ) ?? null,
    [sourceBins, activeSource]
  );

  return (
    <>
      <DrawerBody className="w-full p-0 min-h-0 overflow-y-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full w-full min-h-0"
        >
          <ResizablePanel
            defaultSize={60}
            minSize={35}
            className="flex flex-col min-h-0 overflow-hidden"
          >
            <SourceTable
              data={visibleSources}
              totalCount={filteredSources.length}
              isLoading={sourcesLoading}
              search={search}
              onSearchChange={setSearch}
              activeSource={activeSource}
              lines={wizard.lines}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={40}
            minSize={25}
            className="flex flex-col min-h-0 overflow-hidden"
          >
            <DestinationBinList
              source={activeSourceRow}
              bins={destinationBins}
              isLoading={destinationsLoading}
              lines={wizard.lines}
              emptyTitle={
                activeSourceRow
                  ? t`No other bins hold this item`
                  : t`Select a source`
              }
              emptyHint={
                activeSourceRow
                  ? t`Nothing else at this location has this item to receive stock.`
                  : t`Choose a row on the left to see where its stock can go.`
              }
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </DrawerBody>
      <WizardFooter locationId={locationId} />
    </>
  );
}

// "Required" is not a min/max stocking level — it's open-job demand plus
// outstanding outbound transfers, per the requirements RPC.
function RequiredHeader() {
  return (
    <HStack spacing={1} className="items-center">
      <span>
        <Trans>Required</Trans>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <LuInfo className="size-3.5 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Trans>
            Open job demand plus outstanding transfers out of this bin
          </Trans>
        </TooltipContent>
      </Tooltip>
    </HStack>
  );
}

function SourceTable({
  data,
  totalCount,
  isLoading,
  search,
  onSearchChange,
  activeSource,
  lines
}: {
  data: BinRow[];
  totalCount: number;
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  activeSource: StockTransferSource | null;
  lines: StockTransferWizardLine[];
}) {
  const { t } = useLingui();
  const formatter = useNumberFormatter();

  // Quantity leaving this bin across every line built so far.
  const outgoingFor = useCallback(
    (row: BinRow) =>
      lines
        .filter(
          (line) =>
            line.itemId === row.itemId &&
            line.fromStorageUnitId === row.storageUnitId
        )
        .reduce((sum, line) => sum + (line.quantity ?? 0), 0),
    [lines]
  );

  const columns = useMemo<ColumnDef<BinRow>[]>(
    () => [
      {
        accessorKey: "itemReadableId",
        header: t`Item`,
        cell: ({ row }) => (
          <HStack spacing={2}>
            <ItemThumbnail
              thumbnailPath={row.original.thumbnailPath}
              type="Part"
            />
            <VStack spacing={0} className="min-w-0">
              <span className="text-sm font-medium truncate">
                {row.original.itemReadableId}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {row.original.description}
              </span>
            </VStack>
          </HStack>
        )
      },
      {
        accessorKey: "storageUnitName",
        header: t`Storage Unit`,
        cell: ({ row }) => (
          <HStack spacing={2}>
            <span
              className={cn(
                !row.original.storageUnitName && "text-muted-foreground italic"
              )}
            >
              {binLabel(row.original.storageUnitName, t`No storage unit`)}
            </span>
            {row.original.isDefaultStorageUnit && (
              <Badge variant="secondary">
                <Trans>Default</Trans>
              </Badge>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "quantityOnHand",
        header: t`On Storage Unit`,
        cell: ({ row }) => (
          <QuantityDelta
            base={row.original.quantityOnHand}
            delta={-outgoingFor(row.original)}
            formatter={formatter}
          />
        )
      },
      {
        accessorKey: "quantityRequired",
        header: () => <RequiredHeader />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatter.format(row.original.quantityRequired)}
          </span>
        )
      },
      {
        accessorKey: "quantityAvailable",
        header: t`Available`,
        cell: ({ row }) => {
          const outgoing = outgoingFor(row.original);
          return (
            <QuantityDelta
              base={row.original.quantityAvailable}
              delta={-outgoing}
              formatter={formatter}
              // Flag when the lines you've built would overdraw this bin.
              flagged={row.original.quantityAvailable - outgoing < 0}
            />
          );
        }
      },
      {
        accessorKey: "quantityIncoming",
        header: t`Incoming`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatter.format(row.original.quantityIncoming)}
          </span>
        )
      },
      {
        id: "source",
        header: "",
        cell: ({ row }) => {
          const isActive =
            activeSource?.itemId === row.original.itemId &&
            activeSource?.storageUnitId === row.original.storageUnitId;
          const lineCount = lines.filter(
            (line) =>
              line.itemId === row.original.itemId &&
              line.fromStorageUnitId === row.original.storageUnitId &&
              (line.quantity ?? 0) > 0
          ).length;

          return (
            <HStack spacing={2} className="justify-end">
              {lineCount > 0 && <Count count={lineCount} />}
              <Button
                variant={isActive ? "primary" : "secondary"}
                rightIcon={<LuArrowRight />}
                onClick={() =>
                  setActiveSource(
                    isActive
                      ? null
                      : {
                          itemId: row.original.itemId,
                          storageUnitId: row.original.storageUnitId
                        }
                  )
                }
              >
                {t`Select`}
              </Button>
            </HStack>
          );
        }
      }
    ],
    [t, formatter, activeSource, lines, outgoingFor]
  );

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <div className="flex-1 min-h-0 overflow-hidden w-full px-4">
        <Table<BinRow>
          compact
          data={data}
          columns={columns}
          title={t`Transfer From`}
          titleBadge={<StepBadge step={1} active />}
          // Every URL-param-driven feature is off: this table lives in a drawer
          // stacked over the stock-transfers list, which is itself a Table
          // reading the same `search`/`sort`/`limit` params. Leaving them on
          // would filter the page underneath and leave it mutated on close.
          withPagination={false}
          withSearch={false}
          withSavedView={false}
          withSimpleSorting={false}
          sort={null}
          // The action column must stay reachable while scrolling horizontally.
          defaultColumnPinning={{ left: [], right: ["source"] }}
          headerActions={
            <InputGroup size="sm">
              <InputLeftElement>
                <LuSearch className="text-muted-foreground w-3.5 h-3.5 mt-[-2px]" />
              </InputLeftElement>
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t`Search items or bins`}
                className="w-[140px] sm:w-[220px] text-sm"
              />
            </InputGroup>
          }
          emptyState={
            isLoading ? (
              <div className="flex w-full items-center justify-center py-16">
                <Spinner className="size-8" />
              </div>
            ) : (
              <WizardEmptyState
                icon={<LuPackageSearch className="h-6 w-6 flex-shrink-0" />}
                title={t`No stock at this location`}
                hint={t`No items have inventory activity here yet.`}
              />
            )
          }
        />
        {totalCount > data.length && (
          <p className="text-xs text-muted-foreground pb-3">
            <Trans>
              Showing {data.length} of {totalCount} — refine your search
            </Trans>
          </p>
        )}
      </div>
    </VStack>
  );
}

function QuantityDelta({
  base,
  delta,
  formatter,
  flagged = false
}: {
  base: number;
  delta: number;
  formatter: Intl.NumberFormat;
  flagged?: boolean;
}) {
  const changed = delta !== 0;
  const adjusted = base + delta;
  return (
    <VStack spacing={0}>
      <HStack spacing={1}>
        <span
          className={cn(
            "tabular-nums",
            changed && "text-muted-foreground line-through text-xs"
          )}
        >
          {formatter.format(base)}
        </span>
        {flagged && !changed && (
          <LuFlag className="size-3.5 text-muted-foreground" />
        )}
      </HStack>
      {changed && (
        <HStack spacing={1}>
          <span className="font-medium tabular-nums">
            {formatter.format(adjusted)}
          </span>
          {flagged && <LuFlag className="size-3.5 text-destructive" />}
        </HStack>
      )}
    </VStack>
  );
}

function WizardEmptyState({
  icon,
  title,
  hint
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <VStack
      spacing={4}
      className="w-full items-center justify-center py-16 px-6 text-center"
    >
      <div className="flex justify-center items-center h-12 w-12 rounded-full bg-muted text-muted-foreground">
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
    </VStack>
  );
}

function DestinationBinList({
  source,
  bins,
  isLoading,
  lines,
  emptyTitle,
  emptyHint
}: {
  source: BinRow | null;
  bins: BinRow[];
  isLoading: boolean;
  lines: StockTransferWizardLine[];
  emptyTitle: string;
  emptyHint: string;
}) {
  const { t } = useLingui();

  // Default bin first, then the bins that most need stock.
  const sorted = useMemo(
    () =>
      [...bins].sort((a, b) => {
        if (a.isDefaultStorageUnit !== b.isDefaultStorageUnit) {
          return a.isDefaultStorageUnit ? -1 : 1;
        }
        const shortfallA = a.quantityRequired - a.quantityOnHand;
        const shortfallB = b.quantityRequired - b.quantityOnHand;
        return shortfallB - shortfallA;
      }),
    [bins]
  );

  return (
    <VStack spacing={0} className="h-full min-h-0 overflow-hidden bg-card">
      <HStack
        spacing={2}
        className="px-4 py-3 border-b w-full flex-shrink-0 items-center"
      >
        <StepBadge step={2} active={!!source} />
        <Heading size="h4">
          <Trans>Transfer To</Trans>
        </Heading>
      </HStack>

      {source && (
        <HStack
          spacing={2}
          className="px-4 py-3 border-b w-full flex-shrink-0 bg-primary/5"
        >
          <ItemThumbnail
            thumbnailPath={source.thumbnailPath}
            type="Part"
            size="sm"
          />
          <VStack spacing={0} className="min-w-0">
            <span className="text-sm font-medium truncate">
              {source.itemReadableId}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {source.description}
            </span>
          </VStack>
          <HStack spacing={1} className="flex-shrink-0 ml-auto">
            <Badge variant="outline">
              {binLabel(source.storageUnitName, t`No storage unit`)}
            </Badge>
            <LuArrowRight className="size-3.5 text-muted-foreground" />
          </HStack>
        </HStack>
      )}

      <div className="flex-1 min-h-0 w-full">
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <Spinner className="size-8" />
          </div>
        ) : sorted.length === 0 || !source ? (
          <WizardEmptyState
            icon={
              source ? (
                <LuPackageSearch className="h-6 w-6 flex-shrink-0" />
              ) : (
                <LuMousePointerClick className="h-6 w-6 flex-shrink-0" />
              )
            }
            title={emptyTitle}
            hint={emptyHint}
          />
        ) : (
          <ScrollArea className="h-full w-full">
            <VStack spacing={0} className="p-4">
              {sorted.map((bin) => (
                <DestinationBinRow
                  key={bin.storageUnitId}
                  bin={bin}
                  source={source}
                  lines={lines}
                />
              ))}
            </VStack>
          </ScrollArea>
        )}
      </div>
    </VStack>
  );
}

function DestinationBinRow({
  bin,
  source,
  lines
}: {
  bin: BinRow;
  source: BinRow;
  lines: StockTransferWizardLine[];
}) {
  const { t } = useLingui();
  const formatter = useNumberFormatter();

  const line = lines.find(
    (l) =>
      l.itemId === source.itemId &&
      l.fromStorageUnitId === source.storageUnitId &&
      l.toStorageUnitId === bin.storageUnitId
  );
  const isAdded = !!line;
  // You can't move out more than the source bin holds — and the cap is the
  // capacity *remaining* after the other destinations already drawing on this
  // same bin, or N destinations could each claim the full amount.
  const allocatedElsewhere = lines
    .filter(
      (l) =>
        l.itemId === source.itemId &&
        l.fromStorageUnitId === source.storageUnitId &&
        l.toStorageUnitId !== bin.storageUnitId
    )
    .reduce((sum, l) => sum + (l.quantity ?? 0), 0);
  const maxQuantity = Math.max(
    0,
    source.quantityAvailable - allocatedElsewhere
  );
  const shortfall = Math.max(0, bin.quantityRequired - bin.quantityOnHand);

  const onAdd = () => {
    // Prefer the destination's shortfall, but `Required` is open-job demand and
    // is zero on most rows — defaulting to 0 would make Add look like a no-op.
    // With no demand, seed whatever capacity the source bin has left.
    const defaultQuantity =
      shortfall > 0 ? Math.min(shortfall, maxQuantity) : maxQuantity;
    addTransferLine({
      itemId: source.itemId,
      itemReadableId: source.itemReadableId,
      description: source.description,
      thumbnailPath: source.thumbnailPath,
      fromStorageUnitId: source.storageUnitId,
      fromStorageUnitName: source.storageUnitName!,
      toStorageUnitId: bin.storageUnitId,
      toStorageUnitName: bin.storageUnitName!,
      quantityAvailable: source.quantityAvailable,
      quantity: defaultQuantity,
      requiresSerialTracking: source.itemTrackingType === "Serial",
      requiresBatchTracking: source.itemTrackingType === "Batch"
    });
  };

  return (
    <div
      className={cn(
        "w-full rounded-lg border p-3 mb-2 transition-colors",
        isAdded ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40"
      )}
    >
      <HStack spacing={3} className="justify-between items-start w-full">
        <VStack spacing={0} className="min-w-0">
          <HStack spacing={2}>
            <span
              className={cn(
                "text-sm font-medium truncate",
                !bin.storageUnitName && "text-muted-foreground italic"
              )}
            >
              {binLabel(bin.storageUnitName, t`No storage unit`)}
            </span>
            {bin.isDefaultStorageUnit && (
              <Badge variant="secondary">
                <Trans>Default</Trans>
              </Badge>
            )}
          </HStack>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatter.format(bin.quantityOnHand)} {t`on hand`}
            {shortfall > 0 && (
              <>
                {" · "}
                {formatter.format(shortfall)} {t`short`}
              </>
            )}
            {bin.quantityIncoming > 0 && (
              <>
                {" · "}
                {formatter.format(bin.quantityIncoming)} {t`incoming`}
              </>
            )}
          </span>
        </VStack>

        <HStack spacing={2} className="flex-shrink-0">
          {isAdded && (
            <NumberField
              value={Math.max(0, line?.quantity ?? 0)}
              minValue={0}
              maxValue={maxQuantity}
              onChange={(value: number) => {
                if (value === null || Number.isNaN(value)) return;
                updateTransferLineQuantity(
                  source.itemId,
                  source.storageUnitId,
                  bin.storageUnitId,
                  Math.min(Math.max(0, value), maxQuantity)
                );
              }}
              className="w-24"
            >
              <NumberInputGroup>
                <NumberInput size="sm" />
              </NumberInputGroup>
            </NumberField>
          )}
          <Button
            variant={isAdded ? "secondary" : "primary"}
            onClick={() =>
              isAdded
                ? removeTransferLine(
                    source.itemId,
                    source.storageUnitId,
                    bin.storageUnitId
                  )
                : onAdd()
            }
          >
            {isAdded ? t`Remove` : t`Add`}
          </Button>
        </HStack>
      </HStack>
    </div>
  );
}

function WizardFooter({ locationId }: { locationId: string }) {
  const { t } = useLingui();
  const [wizard] = useStockTransferWizard();
  const linesCount = useStockTransferWizardLinesCount();
  const totalQuantity = useStockTransferWizardTotalQuantity();

  // Item Rule pre-flight on Create Transfer (auto-released → the stock-commit
  // gate sits here). The modal surfaces violations before the transfer exists.
  const createRules = useStorageRuleViolations<Result>({
    action: path.to.newStockTransfer,
    onSuccess: () => clearStockTransferWizard()
  });
  const fetcher = createRules.fetcher;

  const activeLines = useMemo(
    () => wizard.lines.filter((line) => (line.quantity ?? 0) > 0),
    [wizard.lines]
  );

  const submit = useCallback(() => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("lines", JSON.stringify(activeLines));
    createRules.submit(fd);
  }, [activeLines, createRules, locationId]);

  const isSubmitting = fetcher.state !== "idle";

  return (
    <DrawerFooter
      data-wizard-footer
      className="flex-shrink-0 border-t bg-card sm:justify-between items-center"
    >
      <span className="text-sm text-muted-foreground tabular-nums">
        {linesCount === 0 ? (
          <Trans>No lines yet</Trans>
        ) : (
          <>
            <Plural value={linesCount} one="# line" other="# lines" />
            {" · "}
            <Plural value={totalQuantity} one="# unit" other="# units" />
          </>
        )}
      </span>

      <HStack spacing={2}>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" isDisabled={activeLines.length === 0}>
              {t`Review`}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[380px] p-0"
            // A popover portals outside the drawer, where react-remove-scroll's
            // document listener swallows wheel events. See conventions-ui.md.
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <ScrollArea className="max-h-[50dvh] w-full">
              <VStack spacing={0} className="p-2">
                {activeLines.map((line) => (
                  <HStack
                    key={`${line.itemId}-${line.fromStorageUnitId}-${line.toStorageUnitId}`}
                    className="w-full justify-between gap-2 rounded-md p-2 hover:bg-muted/50"
                  >
                    <VStack spacing={0} className="min-w-0">
                      <span className="font-mono text-xs font-semibold truncate">
                        {line.itemReadableId}
                      </span>
                      <HStack spacing={1} className="text-xs">
                        <Badge variant="outline">
                          {binLabel(
                            line.fromStorageUnitName,
                            t`No storage unit`
                          )}
                        </Badge>
                        <LuArrowRight className="size-3 text-muted-foreground" />
                        <Count count={line.quantity ?? 0} />
                        <LuArrowRight className="size-3 text-muted-foreground" />
                        <Badge variant="outline">
                          {binLabel(line.toStorageUnitName, t`No storage unit`)}
                        </Badge>
                      </HStack>
                    </VStack>
                    <IconButton
                      aria-label={t`Remove line`}
                      variant="ghost"
                      size="sm"
                      icon={<LuTrash2 />}
                      onClick={() =>
                        removeTransferLine(
                          line.itemId,
                          line.fromStorageUnitId,
                          line.toStorageUnitId
                        )
                      }
                    />
                  </HStack>
                ))}
              </VStack>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          isDisabled={activeLines.length === 0 || isSubmitting}
          onClick={clearTransferLines}
        >
          {t`Clear`}
        </Button>
        <Button
          isLoading={isSubmitting}
          isDisabled={activeLines.length === 0 || isSubmitting}
          onClick={submit}
        >
          {t`Create Transfer`}
        </Button>
      </HStack>
      <createRules.ViolationModal />
    </DrawerFooter>
  );
}
