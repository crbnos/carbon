// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRuleViolations } from "@carbon/ee/rules";
import {
  DatePicker,
  Hidden,
  NumberControlled,
  Submit,
  ValidatedForm
} from "@carbon/form";
import { LabelDownloadModal } from "@carbon/printing/ui";
import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  copyToClipboard,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Input as SearchInput,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { groupBy, INPUT_FORMAT, round } from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { Fragment, useCallback, useMemo, useState } from "react";
import {
  LuBuilding2,
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCoins,
  LuEllipsisVertical,
  LuPencil,
  LuPrinter,
  LuQrCode,
  LuSearch
} from "react-icons/lu";
import { Link, Outlet, useFetcher } from "react-router";
import type { z } from "zod";
import { DateTime } from "~/components";
import {
  Account,
  Input,
  Location,
  Number as NumberInput,
  Select,
  TextArea
} from "~/components/Form";
import ScrapReason from "~/components/Form/ScrapReason";
import StorageUnit from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCompanyToday,
  useCurrencyDecimals,
  usePermissions,
  usePrinting,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import type {
  ItemStorageUnitQuantities,
  itemTrackingTypes,
  pickMethodValidator
} from "~/modules/items";
import { path } from "~/utils/path";
import {
  inventoryAdjustmentValidator,
  serialUnitRecostValidator
} from "../../inventory.models";

type InventoryStorageUnitsProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemStorageUnitQuantities: ItemStorageUnitQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  itemShelfLife: {
    mode: string | null;
    days: number | null;
  } | null;
  trackedEntityExpirations: Record<string, string | null>;
  storageUnits: { value: string; label: string }[];
};

const InventoryStorageUnits = ({
  itemStorageUnitQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  itemShelfLife,
  trackedEntityExpirations,
  pickMethod,
  storageUnits
}: InventoryStorageUnitsProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const adjustmentModal = useDisclosure();
  const ruleViolations = useRuleViolations({
    action: path.to.inventoryItemAdjustment(pickMethod.itemId),
    onSuccess: adjustmentModal.onClose
  });

  const unitOfMeasures = useUnitOfMeasure();

  const itemUnitOfMeasure = useMemo(
    () => unitOfMeasures.find((unit) => unit.value === itemUnitOfMeasureCode),
    [itemUnitOfMeasureCode, unitOfMeasures]
  );

  const isSerial = itemTrackingType === "Serial";
  const isBatch = itemTrackingType === "Batch";

  const visibleStorageUnitQuantities = useMemo(
    () => itemStorageUnitQuantities.filter((item) => item.quantity !== 0),
    [itemStorageUnitQuantities]
  );

  const storageUnitLabel = useCallback(
    (item: ItemStorageUnitQuantities) =>
      storageUnits.find((s) => s.value === item.storageUnitId)?.label ??
      item.storageUnitName ??
      item.storageUnitId ??
      null,
    [storageUnits]
  );

  const [search, setSearch] = useState("");

  // Matches a storage unit's name or a lot/serial number.
  const matchingStorageUnitQuantities = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visibleStorageUnitQuantities;
    return visibleStorageUnitQuantities.filter((item) =>
      [storageUnitLabel(item), item.readableId, item.trackedEntityId].some(
        (value) => value?.toLowerCase().includes(term)
      )
    );
  }, [visibleStorageUnitQuantities, search, storageUnitLabel]);

  // Rows are grouped twice: by storage unit, then by lot within it. Fragments
  // of the same batch in the same bin collapse into one lot row with the summed
  // quantity, expandable to the underlying tracked entities.
  const storageUnitGroups = useMemo(() => {
    const sumQuantity = (members: ItemStorageUnitQuantities[]) =>
      round(members.reduce((sum, m) => sum + m.quantity, 0));

    const byUnit = groupBy(
      matchingStorageUnitQuantities.map((item, index) => ({ item, index })),
      ({ item }) => item.storageUnitId ?? ""
    );

    return Object.entries(byUnit)
      .map(([storageUnitId, rows]) => {
        const byLot = groupBy(
          rows,
          // Untracked/unnumbered rows get a per-row key so they stay singletons.
          ({ item, index }) =>
            item.readableId ?? item.trackedEntityId ?? `row-${index}`
        );
        const lots = Object.entries(byLot)
          .map(([lotKey, lotRows]) => {
            const members = lotRows.map((r) => r.item);
            return {
              key: `${storageUnitId}::${lotKey}`,
              members,
              quantity: sumQuantity(members)
            };
          })
          // Largest first; serials all hold one, so they fall back to number order.
          .sort(
            (a, b) =>
              b.quantity - a.quantity ||
              (a.members[0].readableId ?? "").localeCompare(
                b.members[0].readableId ?? ""
              )
          );
        const first = rows[0].item;
        return {
          storageUnitId,
          name: storageUnitId ? storageUnitLabel(first) : null,
          quantity: sumQuantity(rows.map((r) => r.item)),
          lots
        };
      })
      .sort((a, b) => {
        // Stock with no storage unit goes last.
        if (!a.name || !b.name) return a.name ? -1 : b.name ? 1 : 0;
        return a.name.localeCompare(b.name);
      });
  }, [matchingStorageUnitQuantities, storageUnitLabel]);

  const formatQuantity = useQuantityFormatter();

  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    new Set()
  );

  const toggleGroup = (key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const [quantity, setQuantity] = useState(1);
  const [selectedStorageUnitId, setSelectedStorageUnitId] = useState<
    string | null
  >(null);
  const [selectedTrackedEntityId, setSelectedTrackedEntityId] = useState<
    string | null
  >(null);
  const [selectedReadableId, setSelectedReadableId] = useState<string | null>(
    null
  );
  const [isEditingRow, setIsEditingRow] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<string>("Set Quantity");

  const isEditing = selectedTrackedEntityId !== null;

  const showExpirationField = isBatch || isSerial;

  const defaultExpirationDate = useMemo(() => {
    if (!showExpirationField) return undefined;
    if (selectedTrackedEntityId) {
      return trackedEntityExpirations[selectedTrackedEntityId] ?? undefined;
    }
    if (
      itemShelfLife?.mode === "Fixed Duration" &&
      itemShelfLife.days &&
      Number(itemShelfLife.days) > 0
    ) {
      return today(getLocalTimeZone())
        .add({ days: Number(itemShelfLife.days) })
        .toString();
    }
    return undefined;
  }, [
    showExpirationField,
    selectedTrackedEntityId,
    trackedEntityExpirations,
    itemShelfLife
  ]);

  const openAdjustmentModal = (
    storageUnitId?: string,
    trackedEntityId?: string,
    readableId?: string,
    currentQuantity?: number
  ) => {
    setSelectedStorageUnitId(storageUnitId || null);
    setSelectedTrackedEntityId(trackedEntityId || null);
    setSelectedReadableId(readableId || null);
    setIsEditingRow(storageUnitId !== undefined);
    // A new serial adjustment has no "Set Quantity" option (see the options list
    // below), so default it to a valid choice instead of an unselectable one.
    setAdjustmentType(
      isSerial && !trackedEntityId ? "Positive Adjmt." : "Set Quantity"
    );
    if (currentQuantity !== undefined) {
      setQuantity(currentQuantity);
    }
    adjustmentModal.onOpen();
  };

  const { printerRoutes, resolvePrinterRoute } = usePrinting();
  const printerModal = useDisclosure();
  const downloadModal = useDisclosure();
  const printFetcher = useFetcher<{ success: boolean; message: string }>();
  const [pendingPrintEntityId, setPendingPrintEntityId] = useState<
    string | null
  >(null);
  const locationId = pickMethod.locationId;
  const defaultPrinter = resolvePrinterRoute(locationId, "inventory");
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>(
    defaultPrinter?.id ?? ""
  );

  const handlePrintLabel = (trackedEntityId: string) => {
    setPendingPrintEntityId(trackedEntityId);
    if (printerRoutes.length > 0) {
      setSelectedPrinterId(defaultPrinter?.id ?? printerRoutes[0]?.id ?? "");
      printerModal.onOpen();
    } else {
      downloadModal.onOpen();
    }
  };

  // A serialized unit can leave stock as a fixed asset (Dr asset / Cr Finished
  // Goods at its carrying cost). The capitalize route reads the unit from the
  // search params; the posting itself needs `create: accounting`.
  const canCapitalize = permissions.can("create", "accounting");

  // What each serial unit would leave stock at — the cost a shipment or a
  // capitalization would relieve. Inventory value is accounting data, so it
  // is only read for someone who can view accounting.
  const canViewCost = isSerial && permissions.can("view", "accounting");
  const { data: serialCosts } = useLoaderQuery<{
    costs: Record<string, number>;
    costingMethod: string | null;
    retainedEarningsAccountId: string | null;
  }>(
    canViewCost
      ? path.to.api.itemSerialCosts(pickMethod.itemId, locationId)
      : null
  );
  const costFormatter = useCurrencyFormatter({ rate: true });

  // Recosting one unit puts a number of the user's own on the books, so it
  // takes accounting update; only a FIFO / LIFO unit carries its own layer.
  const canRecost =
    canViewCost &&
    permissions.can("update", "accounting") &&
    (serialCosts?.costingMethod === "FIFO" ||
      serialCosts?.costingMethod === "LIFO");
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);
  const companyToday = useCompanyToday();
  const retainedEarningsAccountId = serialCosts?.retainedEarningsAccountId;
  const [recostItem, setRecostItem] =
    useState<ItemStorageUnitQuantities | null>(null);
  const recostFetcher = useAction({
    onSuccess: () => setRecostItem(null)
  });
  const unitCostOf = (item: ItemStorageUnitQuantities) =>
    item.trackedEntityId ? serialCosts?.costs[item.trackedEntityId] : undefined;
  const capitalizeHref = (item: ItemStorageUnitQuantities) => {
    const params = new URLSearchParams({
      itemId: pickMethod.itemId,
      trackedEntityId: item.trackedEntityId,
      locationId
    });
    // A unit in no bin has a null storageUnitId; URLSearchParams would send it
    // as the string "null", which then fails the itemLedger bin FK.
    if (item.storageUnitId) params.set("storageUnitId", item.storageUnitId);
    return `${path.to.fixedAssetCapitalize}?${params}`;
  };

  const handleConfirmPrint = () => {
    if (!pendingPrintEntityId || !selectedPrinterId) return;
    printFetcher.submit(
      {
        sourceDocument: "Entity",
        sourceDocumentId: pendingPrintEntityId,
        locationId,
        printerRouteId: selectedPrinterId
      },
      {
        method: "POST",
        action: path.to.manualPrint,
        encType: "application/json"
      }
    );
    toast.success("Print job queued");
    printerModal.onClose();
    setPendingPrintEntityId(null);
  };

  const unitOfMeasureLabel = itemUnitOfMeasure?.label ?? itemUnitOfMeasureCode;

  // Expired lots read red, and lots inside 30 days amber.
  const expirationClassName = (value: string) => {
    const daysLeft = parseDate(value.slice(0, 10)).compare(
      today(getLocalTimeZone())
    );
    if (daysLeft < 0) return "text-destructive";
    if (daysLeft <= 30) return "text-amber-600 dark:text-amber-400";
    return "text-muted-foreground";
  };

  // One grid for every row, so quantities and actions line up down the card.
  const rowClassName =
    "group/row -mx-2 grid h-9 grid-cols-[minmax(0,1fr)_auto_5.25rem] items-center gap-3 rounded-md px-2";

  const renderQuantity = (value: number, className?: string) => (
    <span
      className={cn(
        "text-right tabular-nums",
        value < 0 && "text-destructive",
        className
      )}
    >
      {formatQuantity(value)}
    </span>
  );

  // A unit carried at nothing is the one to recost before it ships or is
  // capitalized, so it reads amber.
  const renderUnitCost = (item: ItemStorageUnitQuantities) => {
    const cost = unitCostOf(item);
    if (cost === undefined) return null;
    return cost > 0 ? (
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {costFormatter.format(cost)}
      </span>
    ) : (
      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
        <Trans>No cost</Trans>
      </span>
    );
  };

  const renderTracking = (
    item: ItemStorageUnitQuantities,
    expiration: string | null | undefined
  ) => (
    <span className="flex min-w-0 items-baseline gap-2">
      {item.trackedEntityId ? (
        <span className="truncate font-mono text-xs">
          {item.readableId ?? item.trackedEntityId}
        </span>
      ) : (
        <span className="text-muted-foreground">
          <Trans>Untracked</Trans>
        </span>
      )}
      {renderUnitCost(item)}
      {expiration && (
        <span
          className={cn("shrink-0 text-xs", expirationClassName(expiration))}
        >
          <Trans>
            Expires <DateTime value={expiration} variant="date" />
          </Trans>
        </span>
      )}
    </span>
  );

  // One trigger per row; the actions live in its menu.
  const renderActions = (item: ItemStorageUnitQuantities) => (
    <HStack
      spacing={0}
      className="justify-end opacity-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`Actions`}
            variant="ghost"
            size="sm"
            icon={<LuEllipsisVertical />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.trackedEntityId && (
            <DropdownMenuItem
              onSelect={async () => {
                // Only confirm a copy that happened.
                if (await copyToClipboard(item.trackedEntityId!)) {
                  toast.success(t`Copied ID to clipboard`);
                }
              }}
            >
              <DropdownMenuIcon icon={<LuQrCode />} />
              <Trans>Copy ID</Trans>
            </DropdownMenuItem>
          )}
          {item.trackedEntityId && (
            <DropdownMenuItem
              onSelect={() => handlePrintLabel(item.trackedEntityId!)}
            >
              <DropdownMenuIcon icon={<LuPrinter />} />
              <Trans>Print Label</Trans>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              openAdjustmentModal(
                item.storageUnitId,
                item.trackedEntityId,
                item.readableId,
                item.quantity
              )
            }
          >
            <DropdownMenuIcon icon={<LuPencil />} />
            <Trans>Update Quantity</Trans>
          </DropdownMenuItem>
          {item.trackedEntityId && canRecost && (
            <DropdownMenuItem onSelect={() => setRecostItem(item)}>
              <DropdownMenuIcon icon={<LuCoins />} />
              <Trans>Recost</Trans>
            </DropdownMenuItem>
          )}
          {/* A fixed asset is one serialized unit; a batch row is many. */}
          {item.trackedEntityId && isSerial && canCapitalize && (
            <DropdownMenuItem asChild>
              <Link to={capitalizeHref(item)}>
                <DropdownMenuIcon icon={<LuBuilding2 />} />
                <Trans>Capitalize as Fixed Asset</Trans>
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </HStack>
  );

  const renderStockRow = (
    item: ItemStorageUnitQuantities,
    key: string,
    indent: string
  ) => (
    <div key={key} className={cn(rowClassName, "hover:bg-muted/60")}>
      <div className={cn("min-w-0", indent)}>
        {renderTracking(
          item,
          item.trackedEntityId
            ? trackedEntityExpirations[item.trackedEntityId]
            : null
        )}
      </div>
      {renderQuantity(item.quantity)}
      {renderActions(item)}
    </div>
  );

  return (
    <>
      <Card className="w-full">
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle className="whitespace-nowrap">
              <Trans>Storage Units</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>
            <HStack>
              {/* A search box over a handful of rows is clutter. */}
              {visibleStorageUnitQuantities.length > 8 && (
                <InputGroup size="sm" className="w-40">
                  <InputLeftElement>
                    <LuSearch className="h-4 w-4" />
                  </InputLeftElement>
                  <SearchInput
                    aria-label={t`Search storage units and tracking numbers`}
                    placeholder={t`Search...`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
              )}
              <Button onClick={() => openAdjustmentModal()}>
                <Trans>Update Inventory</Trans>
              </Button>
            </HStack>
          </CardAction>
        </HStack>
        <CardContent>
          {storageUnitGroups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {search.trim() ? (
                <Trans>No storage units or tracking numbers match.</Trans>
              ) : (
                <Trans>No stock on hand at this location.</Trans>
              )}
            </p>
          )}
          <div className="text-sm">
            {storageUnitGroups.map((unit) => {
              const unitLabel = unit.name ?? (
                <span className="text-muted-foreground">
                  <Trans>No storage unit</Trans>
                </span>
              );
              const [onlyLot] = unit.lots;
              // A bin holding one untracked row needs no lot rows under it.
              const isSingleUntrackedRow =
                unit.lots.length === 1 &&
                onlyLot.members.length === 1 &&
                !onlyLot.members[0].trackedEntityId;

              return (
                <div
                  key={unit.storageUnitId}
                  className="border-t py-1.5 first:border-t-0"
                >
                  <div
                    className={cn(
                      rowClassName,
                      isSingleUntrackedRow && "hover:bg-muted/60"
                    )}
                  >
                    <span className="truncate font-medium">{unitLabel}</span>
                    {renderQuantity(unit.quantity, "font-medium")}
                    {isSingleUntrackedRow ? (
                      renderActions(onlyLot.members[0])
                    ) : (
                      // The unit sits beside the total so the digits stay in one column.
                      <span className="truncate text-xs text-muted-foreground">
                        {unitOfMeasureLabel}
                      </span>
                    )}
                  </div>
                  {!isSingleUntrackedRow &&
                    unit.lots.map((lot) => {
                      const first = lot.members[0];
                      if (lot.members.length === 1) {
                        return renderStockRow(first, lot.key, "pl-7");
                      }
                      const isExpanded = expandedGroupKeys.has(lot.key);
                      const earliestExpiration = lot.members
                        .map((m) =>
                          m.trackedEntityId
                            ? trackedEntityExpirations[m.trackedEntityId]
                            : null
                        )
                        .filter((d): d is string => Boolean(d))
                        .sort()[0];
                      return (
                        <Fragment key={lot.key}>
                          <div className={rowClassName}>
                            <div className="flex min-w-0 items-center">
                              {/* The chevron sits in the gutter the other lots leave empty. */}
                              <IconButton
                                aria-label={
                                  isExpanded ? t`Collapse` : t`Expand`
                                }
                                aria-expanded={isExpanded}
                                variant="ghost"
                                size="sm"
                                className="-ml-0.5 mr-0.5 size-7 shrink-0"
                                icon={
                                  isExpanded ? (
                                    <LuChevronDown />
                                  ) : (
                                    <LuChevronRight />
                                  )
                                }
                                onClick={() => toggleGroup(lot.key)}
                              />
                              {renderTracking(first, earliestExpiration)}
                              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                ×{lot.members.length}
                              </span>
                            </div>
                            {renderQuantity(lot.quantity)}
                            <span />
                          </div>
                          {isExpanded &&
                            lot.members.map((item, index) =>
                              renderStockRow(
                                item,
                                `${lot.key}:${index}`,
                                "pl-14"
                              )
                            )}
                        </Fragment>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      {recostItem?.trackedEntityId && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setRecostItem(null);
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              validator={serialUnitRecostValidator}
              action={path.to.inventoryItemRecost(pickMethod.itemId)}
              fetcher={recostFetcher}
              defaultValues={{
                trackedEntityId: recostItem.trackedEntityId,
                unitCost: unitCostOf(recostItem) ?? 0,
                offsetAccountId: retainedEarningsAccountId ?? "",
                postingDate: companyToday
              }}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Recost {recostItem.readableId ?? ""}</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="trackedEntityId" />
                <VStack spacing={4}>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Sets what this unit is carried at in inventory. The
                      difference is booked between inventory and the account the
                      cost was spent from: Retained Earnings for an earlier
                      year, or this year's labor or material expense.
                    </Trans>
                  </p>
                  <NumberInput
                    name="unitCost"
                    label={t`Unit Cost`}
                    minValue={0}
                    formatOptions={INPUT_FORMAT.rate(
                      company.baseCurrencyCode,
                      currencyDecimals
                    )}
                  />
                  <Account name="offsetAccountId" label={t`Offset Account`} />
                  <DatePicker name="postingDate" label={t`Posting Date`} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={() => setRecostItem(null)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit>
                  <Trans>Recost</Trans>
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
      {adjustmentModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              adjustmentModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              validator={inventoryAdjustmentValidator}
              fetcher={ruleViolations.fetcher}
              action={path.to.inventoryItemAdjustment(pickMethod.itemId)}
              defaultValues={{
                itemId: pickMethod.itemId,
                quantity: isSerial && !isEditing ? 1 : quantity,
                locationId: pickMethod.locationId,
                storageUnitId: selectedStorageUnitId || undefined,
                originalStorageUnitId: isEditing
                  ? selectedStorageUnitId || undefined
                  : undefined,
                adjustmentType:
                  isSerial && !isEditing ? "Positive Adjmt." : "Set Quantity",
                trackedEntityId: selectedTrackedEntityId || nanoid(),
                readableId: selectedReadableId || undefined,
                expirationDate: defaultExpirationDate
              }}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Inventory Adjustment</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="itemId" />
                {isEditing && <Hidden name="originalStorageUnitId" />}
                <Hidden
                  name="requiresSerialTracking"
                  value={isSerial ? "true" : "false"}
                />

                <VStack spacing={2}>
                  <Location name="locationId" label={t`Location`} isReadOnly />
                  <StorageUnit
                    name="storageUnitId"
                    locationId={pickMethod.locationId}
                    label={t`Storage Unit`}
                    isReadOnly={isEditingRow}
                  />
                  <Select
                    name="adjustmentType"
                    label={t`Adjustment Type`}
                    termId="inventory-adjustment-type"
                    onChange={(option) =>
                      setAdjustmentType(option?.value ?? "Set Quantity")
                    }
                    options={
                      isEditing && (isSerial || isBatch)
                        ? [
                            { label: t`Set Quantity`, value: "Set Quantity" },
                            {
                              label: t`Negative Adjustment`,
                              value: "Negative Adjmt."
                            },
                            { label: t`Scrap`, value: "Scrap" }
                          ]
                        : [
                            ...(isSerial
                              ? []
                              : [
                                  {
                                    label: "Set Quantity",
                                    value: "Set Quantity"
                                  }
                                ]),
                            {
                              label: t`Positive Adjustment`,
                              value: "Positive Adjmt."
                            },
                            {
                              label: t`Negative Adjustment`,
                              value: "Negative Adjmt."
                            },
                            { label: t`Scrap`, value: "Scrap" }
                          ]
                    }
                  />
                  {adjustmentType === "Scrap" && (
                    <ScrapReason name="scrapReasonId" label={t`Scrap Reason`} />
                  )}
                  {(isBatch || isSerial) && (
                    <>
                      <Hidden name="trackedEntityId" />
                      <Input
                        name="readableId"
                        label={isSerial ? t`Serial Number` : t`Batch Number`}
                        termId={
                          isSerial
                            ? "inventory-adjustment-serial-number"
                            : "inventory-adjustment-batch-number"
                        }
                      />
                      {showExpirationField && (
                        <DatePicker
                          name="expirationDate"
                          label={t`Expiration Date`}
                          termId="inventory-adjustment-expiration-date"
                        />
                      )}
                    </>
                  )}
                  <NumberControlled
                    name="quantity"
                    label={t`Quantity`}
                    minValue={0}
                    maxValue={isSerial && isEditing ? 1 : undefined}
                    value={isSerial && !isEditing ? 1 : quantity}
                    onChange={setQuantity}
                    isReadOnly={isSerial && !isEditing}
                  />

                  <Input
                    name="unitOfMeasure"
                    label={t`Unit of Measure`}
                    value={itemUnitOfMeasure?.label ?? ""}
                    isReadOnly
                  />
                  <TextArea name="comment" label={t`Comment`} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={adjustmentModal.onClose} variant="secondary">
                  <Trans>Cancel</Trans>
                </Button>
                <Submit
                  withBlocker={false}
                  isDisabled={!permissions.can("update", "inventory")}
                >
                  Save
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
      <ruleViolations.ViolationModal />
      {printerModal.isOpen && pendingPrintEntityId && (
        <Modal open onOpenChange={(open) => !open && printerModal.onClose()}>
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
                      <span className="text-sm font-medium">{route.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 uppercase">
                        {route.format}
                      </span>
                    </div>
                    {selectedPrinterId === route.id && (
                      <LuCheck className="size-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  leftIcon={<LuPrinter />}
                  disabled={!selectedPrinterId}
                  onClick={handleConfirmPrint}
                >
                  <Trans>Print</Trans>
                </Button>
                <Button variant="solid" onClick={printerModal.onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
      {downloadModal.isOpen && pendingPrintEntityId && (
        <LabelDownloadModal
          sourceDocumentId={pendingPrintEntityId}
          fileRoutes={{
            pdf: path.to.file.trackedEntityLabelPdf,
            zpl: path.to.file.trackedEntityLabelZpl
          }}
          isOpen={downloadModal.isOpen}
          onClose={() => {
            downloadModal.onClose();
            setPendingPrintEntityId(null);
          }}
        />
      )}
      <Outlet />
    </>
  );
};

export default InventoryStorageUnits;
