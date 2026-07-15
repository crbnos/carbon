import {
  Button,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuInfo,
  LuScale,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hyperlink, ItemThumbnail, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
import type {
  InventoryTieOutRow,
  InventoryValuationRow
} from "~/modules/inventory";
import { path } from "~/utils/path";

type InventoryValuationWorkbenchProps = {
  rows: InventoryValuationRow[];
  tieOut: InventoryTieOutRow[] | null;
  // The tie-out query failed — distinct from "accounting disabled" (null).
  tieOutError?: boolean;
  asOfDate: string;
  groupBy: "location" | "item";
  locationId: string | null;
  locations: { id: string; name: string }[];
};

// A group row is a location (default grouping) or an item; its details are the
// rows of the other dimension. One union type so a single ColumnDef set renders
// both, branching on `kind` — the ARAPWorkbench heterogeneous-tree pattern.
type ValuationRow =
  | {
      kind: "group";
      id: string;
      label: string;
      // Set when grouping by item — renders the standard ItemThumbnail +
      // stacked readableId/name cell (InventoryTable precedent).
      item?: Pick<
        InventoryValuationRow,
        "itemId" | "readableIdWithRevision" | "name" | "thumbnailPath" | "type"
      >;
      quantityOnHand: number;
      quantityOnHold: number;
      quantityRejected: number;
      totalValue: number;
      pctOfTotal: number;
    }
  | ({
      kind: "detail";
      rowId: string;
      groupId: string;
      pctOfTotal: number;
    } & InventoryValuationRow);

// Mirrors ARAPWorkbench: swallow floating-point dust in the subledger-vs-GL
// comparison.
const VARIANCE_EPSILON = 0.005;

export function InventoryValuationWorkbench({
  rows,
  tieOut,
  tieOutError,
  asOfDate,
  groupBy,
  locationId,
  locations
}: InventoryValuationWorkbenchProps) {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const permissions = usePermissions();
  const reconcileFetcher = useFetcher<object>();
  const unitOfMeasures = useUnitOfMeasure();

  const money = useCallback(
    (n: number) => currencyFormatter.format(Number(n)),
    [currencyFormatter]
  );
  const quantity = useCallback((n: number) => Number(n).toLocaleString(), []);

  const isDated = asOfDate < new Date().toISOString().slice(0, 10);

  const grandTotal = useMemo(
    () => rows.reduce((acc, r) => acc + Number(r.totalValue), 0),
    [rows]
  );

  // Group by the selected dimension; details are the other dimension's rows.
  const { groups, childrenByGroup } = useMemo(() => {
    const byGroup = new Map<
      string,
      { label: string; children: InventoryValuationRow[] }
    >();
    for (const r of rows) {
      const key = groupBy === "location" ? r.locationId : r.itemId;
      const label =
        groupBy === "location"
          ? r.locationName
          : `${r.readableIdWithRevision} · ${r.name}`;
      const entry = byGroup.get(key) ?? { label, children: [] };
      entry.children.push(r);
      byGroup.set(key, entry);
    }
    const sorted = [...byGroup.entries()].sort(([, a], [, b]) =>
      a.label.localeCompare(b.label)
    );
    const groupRows = sorted.map(([id, { label, children }]) => ({
      kind: "group" as const,
      id,
      label,
      item:
        groupBy === "item" && children[0]
          ? {
              itemId: children[0].itemId,
              readableIdWithRevision: children[0].readableIdWithRevision,
              name: children[0].name,
              thumbnailPath: children[0].thumbnailPath,
              type: children[0].type
            }
          : undefined,
      quantityOnHand: children.reduce(
        (s, c) => s + Number(c.quantityOnHand),
        0
      ),
      quantityOnHold: children.reduce(
        (s, c) => s + Number(c.quantityOnHold),
        0
      ),
      quantityRejected: children.reduce(
        (s, c) => s + Number(c.quantityRejected),
        0
      ),
      totalValue: children.reduce((s, c) => s + Number(c.totalValue), 0),
      pctOfTotal:
        grandTotal === 0
          ? 0
          : children.reduce((s, c) => s + Number(c.totalValue), 0) / grandTotal
    }));
    const childMap: Record<string, InventoryValuationRow[]> = {};
    for (const [id, { children }] of sorted) childMap[id] = children;
    return { groups: groupRows, childrenByGroup: childMap };
  }, [rows, groupBy, grandTotal]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Flatten groups (roots), expanded details, and a grand-total row.
  const displayRows = useMemo<ValuationRow[]>(() => {
    const out: ValuationRow[] = [];
    for (const g of groups) {
      out.push(g);
      if (expandedIds.has(g.id)) {
        for (const r of childrenByGroup[g.id] ?? []) {
          out.push({
            kind: "detail",
            rowId: `${r.locationId}:${r.itemId}`,
            groupId: g.id,
            pctOfTotal:
              grandTotal === 0 ? 0 : Number(r.totalValue) / grandTotal,
            ...r
          });
        }
      }
    }
    if (groups.length > 0) {
      out.push({
        kind: "group",
        id: "grand-total",
        label: t`Total`,
        quantityOnHand: groups.reduce((s, g) => s + g.quantityOnHand, 0),
        quantityOnHold: groups.reduce((s, g) => s + g.quantityOnHold, 0),
        quantityRejected: groups.reduce((s, g) => s + g.quantityRejected, 0),
        totalValue: grandTotal,
        pctOfTotal: grandTotal === 0 ? 0 : 1
      });
    }
    return out;
  }, [groups, childrenByGroup, expandedIds, grandTotal, t]);

  const detailLabel = useCallback(
    (r: Extract<ValuationRow, { kind: "detail" }>) =>
      groupBy === "location"
        ? `${r.readableIdWithRevision} · ${r.name}`
        : r.locationName,
    [groupBy]
  );

  const columns = useMemo<ColumnDef<ValuationRow>[]>(() => {
    return [
      {
        id: "label",
        header:
          groupBy === "location" ? t`Location / Item` : t`Item / Location`,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === "group") {
            const kids = childrenByGroup[r.id] ?? [];
            const isExpanded = expandedIds.has(r.id);
            return (
              <div className="flex items-center">
                <div className="w-5 shrink-0 flex items-center justify-center self-center">
                  {kids.length > 0 ? (
                    <button
                      type="button"
                      aria-label={isExpanded ? t`Collapse` : t`Expand`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(r.id);
                      }}
                    >
                      {isExpanded ? (
                        <LuChevronDown className="size-4" />
                      ) : (
                        <LuChevronRight className="size-4" />
                      )}
                    </button>
                  ) : null}
                </div>
                {r.item ? (
                  <HStack className="py-1">
                    <ItemThumbnail
                      size="sm"
                      thumbnailPath={r.item.thumbnailPath}
                      // @ts-expect-error
                      type={r.item.type}
                    />
                    <Hyperlink
                      to={path.to.inventoryItemActivity(r.item.itemId)}
                    >
                      <VStack spacing={0}>
                        {r.item.readableIdWithRevision}
                        <div className="w-full truncate text-muted-foreground text-xs">
                          {r.item.name}
                        </div>
                      </VStack>
                    </Hyperlink>
                  </HStack>
                ) : (
                  <span className="font-semibold">{r.label}</span>
                )}
              </div>
            );
          }
          return (
            <div className="flex items-center">
              <div
                aria-hidden
                className="w-5 shrink-0 border-l border-border -my-2"
              />
              <div className="flex items-center gap-2 pl-2 py-1">
                {groupBy === "location" ? (
                  <HStack className="py-1">
                    <ItemThumbnail
                      size="sm"
                      thumbnailPath={r.thumbnailPath}
                      // @ts-expect-error
                      type={r.type}
                    />
                    <Hyperlink to={path.to.inventoryItemActivity(r.itemId)}>
                      <VStack spacing={0}>
                        {r.readableIdWithRevision}
                        <div className="w-full truncate text-muted-foreground text-xs">
                          {r.name}
                        </div>
                      </VStack>
                    </Hyperlink>
                  </HStack>
                ) : (
                  <Enumerable value={r.locationName} />
                )}
              </div>
            </div>
          );
        },
        meta: {
          exportValue: (row: ValuationRow) =>
            row.kind === "group" ? row.label : detailLabel(row)
        }
      },
      {
        id: "method",
        header: t`Costing Method`,
        cell: ({ row }) =>
          row.original.kind === "detail" ? (
            <Enumerable value={row.original.costingMethod} />
          ) : null,
        meta: {
          exportValue: (row: ValuationRow) =>
            row.kind === "detail" ? row.costingMethod : null
        }
      },
      {
        id: "qtyOnHand",
        header: t`Qty On Hand`,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              Number(row.original.quantityOnHand) < 0 && "text-destructive"
            )}
          >
            {quantity(row.original.quantityOnHand)}
          </span>
        ),
        meta: {
          exportValue: (row: ValuationRow) => row.quantityOnHand
        }
      },
      {
        id: "onHold",
        header: t`On Hold`,
        cell: ({ row }) =>
          Number(row.original.quantityOnHold) !== 0 ? (
            <span className="tabular-nums">
              {quantity(row.original.quantityOnHold)}
            </span>
          ) : null,
        meta: {
          exportValue: (row: ValuationRow) => row.quantityOnHold
        }
      },
      {
        id: "rejected",
        header: t`Rejected`,
        cell: ({ row }) =>
          Number(row.original.quantityRejected) !== 0 ? (
            <span className="tabular-nums">
              {quantity(row.original.quantityRejected)}
            </span>
          ) : null,
        meta: {
          exportValue: (row: ValuationRow) => row.quantityRejected
        }
      },
      {
        id: "uom",
        header: t`Unit of Measure`,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind !== "detail") return null;
          const unitOfMeasure = unitOfMeasures.find(
            (uom) => uom.value === r.unitOfMeasureCode
          );
          return (
            <Enumerable value={unitOfMeasure?.label ?? r.unitOfMeasureCode} />
          );
        },
        meta: {
          exportValue: (row: ValuationRow) =>
            row.kind === "detail"
              ? (unitOfMeasures.find(
                  (uom) => uom.value === row.unitOfMeasureCode
                )?.label ?? row.unitOfMeasureCode)
              : null
        }
      },
      {
        id: "unitCost",
        header: t`Unit Cost`,
        cell: ({ row }) =>
          row.original.kind === "detail" ? (
            <span className="tabular-nums">{money(row.original.unitCost)}</span>
          ) : null,
        meta: {
          exportValue: (row: ValuationRow) =>
            row.kind === "detail" ? row.unitCost : null
        }
      },
      {
        id: "totalValue",
        header: t`Total Value`,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span
              className={cn(
                "tabular-nums",
                r.kind === "group" && "font-semibold",
                Number(r.totalValue) < 0 && "text-destructive"
              )}
            >
              {money(r.totalValue)}
            </span>
          );
        },
        meta: {
          exportValue: (row: ValuationRow) => row.totalValue
        }
      },
      {
        id: "pctOfTotal",
        header: t`% of Total`,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {percentFormatter.format(row.original.pctOfTotal)}
          </span>
        ),
        meta: {
          exportValue: (row: ValuationRow) => row.pctOfTotal
        }
      }
    ];
  }, [
    t,
    groupBy,
    childrenByGroup,
    expandedIds,
    toggleExpand,
    detailLabel,
    money,
    quantity,
    percentFormatter,
    unitOfMeasures
  ]);

  const hasVariance = (tieOut ?? []).some(
    (row) => Math.abs(Number(row.variance)) > VARIANCE_EPSILON
  );
  const tieOutTotal = useMemo(() => {
    const list = tieOut ?? [];
    return {
      subledgerValue: list.reduce((s, r) => s + Number(r.subledgerValue), 0),
      glBalance: list.reduce((s, r) => s + Number(r.glBalance), 0),
      variance: list.reduce((s, r) => s + Number(r.variance), 0)
    };
  }, [tieOut]);

  const filters = (
    <HStack>
      {tieOutError ? (
        // The tie-out query failed — say so; rendering nothing would read as
        // "no variance" on a financial control surface.
        <Button variant="destructive" leftIcon={<LuTriangleAlert />} isDisabled>
          <Trans>Tie-Out unavailable</Trans>
        </Button>
      ) : null}
      {tieOut && tieOut.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={hasVariance ? "destructive" : "secondary"}
              leftIcon={hasVariance ? <LuTriangleAlert /> : <LuScale />}
            >
              <Trans>Tie-Out</Trans>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-96">
            <PopoverHeader>
              <Trans>GL Tie-Out</Trans>
            </PopoverHeader>
            <div className="flex flex-col gap-3 p-4">
              {locationId ? (
                // The tie-out (and its Reconcile journal) always covers the
                // whole company — flag that while the table is filtered to a
                // single location so the two aren't read as the same scope.
                <span className="text-xs text-muted-foreground">
                  <Trans>Company-wide — includes all locations</Trans>
                </span>
              ) : null}
              {tieOut.map((row) => {
                const rowVariance =
                  Math.abs(Number(row.variance)) > VARIANCE_EPSILON;
                return (
                  <div key={row.accountKind} className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {row.accountName ??
                        (row.accountKind === "rawMaterials"
                          ? t`Raw Materials`
                          : t`Finished Goods`)}
                    </span>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        <Trans>Subledger</Trans>
                      </span>
                      <span className="tabular-nums">
                        {money(row.subledgerValue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        <Trans>GL</Trans>
                      </span>
                      <span className="tabular-nums">
                        {money(row.glBalance)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        <Trans>Variance</Trans>
                      </span>
                      <span
                        className={cn(
                          "tabular-nums font-semibold",
                          rowVariance
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {money(row.variance)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-sm border-t border-border pt-3">
                <span className="text-muted-foreground">
                  <Trans>Total Variance</Trans>
                </span>
                <span
                  className={cn(
                    "tabular-nums font-semibold flex items-center gap-1",
                    hasVariance
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {hasVariance ? (
                    <LuTriangleAlert className="size-3.5" />
                  ) : null}
                  {money(tieOutTotal.variance)}
                </span>
              </div>
              {hasVariance && permissions.can("create", "accounting") ? (
                <reconcileFetcher.Form
                  method="post"
                  action={path.to.inventoryValuationReconcile}
                >
                  <input type="hidden" name="asOfDate" value={asOfDate} />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full"
                    leftIcon={<LuScale />}
                    isLoading={reconcileFetcher.state !== "idle"}
                    isDisabled={reconcileFetcher.state !== "idle"}
                  >
                    <Trans>Reconcile</Trans>
                  </Button>
                </reconcileFetcher.Form>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" rightIcon={<LuChevronDown />}>
            {groupBy === "location" ? (
              <Trans>By Location</Trans>
            ) : (
              <Trans>By Item</Trans>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup value={groupBy}>
            <DropdownMenuRadioItem
              value="location"
              onClick={() => setParams({ groupBy: "location" })}
            >
              <Trans>By Location</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="item"
              onClick={() => setParams({ groupBy: "item" })}
            >
              <Trans>By Item</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" rightIcon={<LuChevronDown />}>
            {locations.find((location) => location.id === locationId)?.name ?? (
              <Trans>All Locations</Trans>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup value={locationId ?? "all"}>
            <DropdownMenuRadioItem
              value="all"
              onClick={() => setParams({ locationId: undefined })}
            >
              <Trans>All Locations</Trans>
            </DropdownMenuRadioItem>
            {locations.map((location) => (
              <DropdownMenuRadioItem
                key={location.id}
                value={location.id}
                onClick={() => setParams({ locationId: location.id })}
              >
                {location.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>As of:</Trans>
      </span>
      <DatePicker
        size="sm"
        value={parseDate(asOfDate)}
        onChange={(value) =>
          setParams({ asOfDate: value?.toString() ?? asOfDate })
        }
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      {isDated ? (
        <div className="w-full flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground border-b border-border">
          <LuInfo className="size-4 shrink-0" />
          <Trans>
            Values apply today's unit costs to historical quantities.
          </Trans>
        </div>
      ) : null}
      <div className="flex-1 w-full">
        <Table<ValuationRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Inventory Valuation`}
          primaryAction={filters}
          defaultColumnPinning={{ left: ["label"] }}
        />
      </div>
    </VStack>
  );
}
