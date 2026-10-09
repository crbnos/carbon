// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious
} from "@carbon/react/Carousel";

import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuTrash } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import type { z } from "zod";
import { DateTime } from "~/components";
import { EditableNumber } from "~/components/Editable";
import {
  ConversionFactor,
  Currency,
  CustomFormFields,
  Hidden,
  Input,
  Item,
  Number,
  Submit,
  Supplier,
  UnitOfMeasure
} from "~/components/Form";
import Grid from "~/components/Grid";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { supplierPartValidator } from "../../items.models";

/** The item types a supplier part can be saved for: each has a purchasing route. */
export const supplierPartItemTypes = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;
export type SupplierPartItemType = (typeof supplierPartItemTypes)[number];

export function isSupplierPartItemType(
  type: string | null | undefined
): type is SupplierPartItemType {
  return supplierPartItemTypes.includes(type as SupplierPartItemType);
}

type PriceBreak = {
  quantity: number;
  supplierUnitPrice: number;
  leadTime: number;
  sourceType: string;
  sourceDocumentId: string | null;
  createdAt: string;
};

// leadTime is not edited here, but rides along so saving the drawer (which
// rewrites every break) keeps the lead times a quote or order recorded.
type PriceBreakRow = {
  quantity: number;
  supplierUnitPrice: number;
  leadTime: number;
};

type PurchaseHistoryItem = {
  id: string;
  purchaseQuantity: number | null;
  supplierUnitPrice: number | null;
  purchaseOrderId: string;
  purchaseOrder: {
    purchaseOrderId: string;
    supplierId: string;
    orderDate: string | null;
    currencyCode: string | null;
  };
};

type SupplierPartFormProps = {
  initialValues: z.infer<typeof supplierPartValidator>;
  type: SupplierPartItemType;
  unitOfMeasureCode: string;
  priceBreaks?: PriceBreak[];
  purchasingHistory?: PurchaseHistoryItem[];
  // Opened from a supplier rather than an item: the item is picked in the form
  // and the supplier is fixed. The picked item decides the type and unit.
  selectItem?: boolean;
  // Items the picker leaves out: those the supplier already has a supplier part for.
  excludeItemIds?: string[];
  onClose: () => void;
};

const SupplierPartForm = ({
  initialValues,
  type,
  unitOfMeasureCode,
  priceBreaks: initialPriceBreaks = [],
  purchasingHistory = [],
  selectItem = false,
  excludeItemIds,
  onClose
}: SupplierPartFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  // The price and its breaks are in this currency — the supplier's own by
  // default, so a price is entered exactly as the supplier quoted it.
  const [currencyCode, setCurrencyCode] = useState<string>(
    initialValues.currencyCode ?? baseCurrency
  );
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const onSupplierChange = async (supplierId: string | undefined) => {
    if (!supplierId || !carbon) return;
    const { data, error } = await carbon
      .from("supplier")
      .select("currencyCode")
      .eq("id", supplierId)
      .single();
    if (error) {
      toast.error(t`Error fetching supplier data`);
      return;
    }
    setCurrencyCode(data.currencyCode ?? baseCurrency);
  };

  let { itemId } = useParams();

  if (!itemId) {
    itemId = initialValues.itemId;
  }

  const [items] = useItems();
  const [selectedItemId, setSelectedItemId] = useState(initialValues.itemId);
  const selectedItem = selectItem
    ? items.find((item) => item.id === selectedItemId)
    : undefined;
  const itemType =
    selectedItem && isSupplierPartItemType(selectedItem.type)
      ? selectedItem.type
      : type;
  const inventoryCode = selectItem
    ? selectedItem?.unitOfMeasureCode
    : unitOfMeasureCode;

  const [purchaseUnitOfMeasure, setPurchaseUnitOfMeasure] = useState<
    string | undefined
  >(initialValues.supplierUnitOfMeasureCode);

  const [priceBreaks, setPriceBreaks] = useState<PriceBreakRow[]>(
    initialPriceBreaks.map((pb) => ({
      quantity: pb.quantity,
      supplierUnitPrice: pb.supplierUnitPrice,
      leadTime: pb.leadTime
    }))
  );

  const hasInvalidPriceBreaks = priceBreaks.some(
    (pb) => pb.quantity <= 0 || pb.supplierUnitPrice <= 0
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const action = getAction(
    isEditing,
    itemType,
    selectItem ? selectedItemId : itemId,
    initialValues.id
  );
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: onClose must be excluded — it is a new ref each render in route components, which would cause an infinite re-fire loop
  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data?.message) toast.success(fetcher.data.message);
      onClose();
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success, fetcher.data?.message]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="md">
        <ValidatedForm
          defaultValues={initialValues}
          validator={supplierPartValidator}
          method="post"
          action={action}
          className="flex flex-col h-full"
          fetcher={fetcher}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Supplier Part` : t`New Supplier Part`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            {!selectItem && <Hidden name="itemId" />}
            <Hidden name="priceBreaks" value={JSON.stringify(priceBreaks)} />

            <VStack spacing={4}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
                {selectItem && (
                  <Item
                    name="itemId"
                    label={t`Item`}
                    type="Item"
                    validItemTypes={[...supplierPartItemTypes]}
                    replenishmentSystem="Buy"
                    blacklist={excludeItemIds}
                    isOptional={false}
                    onChange={(value) => setSelectedItemId(value?.value ?? "")}
                  />
                )}
                <Supplier
                  name="supplierId"
                  label={t`Supplier`}
                  isReadOnly={selectItem}
                  onChange={(value) => onSupplierChange(value?.value)}
                />
                <Input
                  name="supplierPartId"
                  label={t`Supplier Part ID`}
                  termId="supplier-part-id"
                />
                <Currency
                  name="currencyCode"
                  label={t`Currency`}
                  value={currencyCode}
                  onChange={(value) => {
                    if (value?.value) setCurrencyCode(value.value);
                  }}
                />
                <Number
                  name="supplierUnitPrice"
                  label={t`Unit Price`}
                  helperText={t`Per purchase unit`}
                  minValue={0}
                  formatOptions={INPUT_FORMAT.rate(
                    currencyCode,
                    currencyDecimals
                  )}
                />
                <UnitOfMeasure
                  name="supplierUnitOfMeasureCode"
                  label={t`Unit of Measure`}
                  onChange={(value) => {
                    if (value) setPurchaseUnitOfMeasure(value.value);
                  }}
                />
                <ConversionFactor
                  name="conversionFactor"
                  label={t`Conversion Factor`}
                  termId="conversion-factor"
                  inventoryCode={inventoryCode ?? undefined}
                  purchasingCode={purchaseUnitOfMeasure}
                />
                <Number
                  name="minimumOrderQuantity"
                  label={t`Minimum Order Quantity`}
                  minValue={0}
                  termId="supplier-part-moq"
                />
                <Number
                  name="orderMultiple"
                  label={t`Order Multiple`}
                  minValue={1}
                  termId="supplier-part-order-multiple"
                />
                <CustomFormFields table="supplierPart" />
              </div>
              <PriceBreaks
                priceBreaks={priceBreaks}
                onChange={setPriceBreaks}
                currencyCode={currencyCode}
                isDisabled={isDisabled}
              />
              <PurchaseHistory
                history={purchasingHistory}
                baseCurrency={baseCurrency}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={
                  isDisabled ||
                  hasInvalidPriceBreaks ||
                  (selectItem && !selectedItemId) ||
                  fetcher.state !== "idle"
                }
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

function PurchaseHistory({
  history,
  baseCurrency
}: {
  history: PurchaseHistoryItem[];
  baseCurrency: string;
}) {
  const { t } = useLingui();
  if (history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Purchase History</Trans>
        </CardTitle>
        <CardDescription>
          <span className="text-sm text-muted-foreground">
            {t`${history.length} orders`}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Carousel className="w-full">
          <CarouselContent className="-ml-4">
            {history.map((line) => (
              <CarouselItem
                key={line.id}
                className="pl-4 basis-full lg:basis-1/2"
              >
                <Card className="w-full p-0">
                  <CardContent className="p-4">
                    <HStack className="flex justify-between">
                      <Link
                        to={path.to.purchaseOrder(line.purchaseOrderId)}
                        className="text-sm font-medium hover:underline"
                      >
                        {line.purchaseOrder.purchaseOrderId}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {line.purchaseOrder.orderDate ? (
                          <DateTime
                            value={line.purchaseOrder.orderDate}
                            variant="date"
                          />
                        ) : (
                          "—"
                        )}
                      </span>
                    </HStack>
                    <div className="my-4">
                      <Table>
                        <Thead>
                          <Tr className="border-b border-border">
                            <Th>
                              <span className="font-medium">Quantity</span>
                            </Th>
                            <Th>
                              <span className="font-medium">Price</span>
                            </Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          <Tr>
                            <Td>{line.purchaseQuantity}</Td>
                            <Td>
                              <PurchaseHistoryPrice
                                price={line.supplierUnitPrice ?? 0}
                                currencyCode={
                                  line.purchaseOrder.currencyCode ??
                                  baseCurrency
                                }
                              />
                            </Td>
                          </Tr>
                        </Tbody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          {history.length > 1 && (
            <div className="flex justify-between mt-4">
              <CarouselPrevious />
              <CarouselNext />
            </div>
          )}
        </Carousel>
      </CardContent>
    </Card>
  );
}

// What the order paid, in the order's own currency.
function PurchaseHistoryPrice({
  price,
  currencyCode
}: {
  price: number;
  currencyCode: string;
}) {
  const formatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode
  });
  return <>{formatter.format(price)}</>;
}

function PriceBreaks({
  priceBreaks,
  onChange,
  currencyCode,
  isDisabled
}: {
  priceBreaks: PriceBreakRow[];
  onChange: React.Dispatch<React.SetStateAction<PriceBreakRow[]>>;
  currencyCode: string;
  isDisabled: boolean;
}) {
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const { t } = useLingui();
  // supplierUnitPrice is a RATE, not a settlement amount — see numeric-precision.md
  const formatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode
  });

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => [
      ...prev,
      { quantity: 0, supplierUnitPrice: 0, leadTime: 0 }
    ]);
  }, [onChange]);

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: PriceBreakRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(noOpMutation),
      supplierUnitPrice: EditableNumber(noOpMutation, {
        formatOptions: INPUT_FORMAT.rate(currencyCode, currencyDecimals)
      })
    }),
    [noOpMutation, currencyCode, currencyDecimals]
  );

  const columns = useMemo<ColumnDef<PriceBreakRow>[]>(() => {
    const cols: ColumnDef<PriceBreakRow>[] = [
      {
        accessorKey: "quantity",
        header: t`Quantity`,
        cell: ({ row }) => (
          <span className="block min-w-[80px]">{row.original.quantity}</span>
        )
      },
      {
        accessorKey: "supplierUnitPrice",
        header: t`Unit Price`,
        cell: ({ row }) => formatter.format(row.original.supplierUnitPrice)
      }
    ];

    // A price break is local, unsaved state until the drawer is submitted, so
    // removing a row costs nothing and needs no confirmation — it gets its own
    // column and deletes in one click rather than hiding behind a kebab menu.
    if (!isDisabled) {
      cols.push({
        id: "delete",
        header: "",
        size: 40,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={t`Delete Price Break`}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
            onClick={(e) => {
              e.stopPropagation();
              removeRow(row.index);
            }}
          >
            <LuTrash className="w-4 h-4" />
          </button>
        )
      });
    }

    return cols;
  }, [isDisabled, removeRow, formatter, t]);

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">
        <Trans>Price Breaks</Trans>
      </span>
      <Grid<PriceBreakRow>
        data={priceBreaks}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? addRow : undefined}
        contained={false}
      />
    </div>
  );
}

export default SupplierPartForm;

function getAction(
  isEditing: boolean,
  type: "Part" | "Service" | "Tool" | "Consumable" | "Material",
  itemId: string,
  id?: string
) {
  if (type === "Part") {
    if (isEditing) {
      return path.to.partSupplier(itemId, id!);
    } else {
      return path.to.newPartSupplier(itemId);
    }
  }
  if (type === "Service") {
    if (isEditing) {
      return path.to.serviceSupplier(itemId, id!);
    } else {
      return path.to.newServiceSupplier(itemId);
    }
  }

  if (type === "Tool") {
    if (isEditing) {
      return path.to.toolSupplier(itemId, id!);
    } else {
      return path.to.newToolSupplier(itemId);
    }
  }

  if (type === "Consumable") {
    if (isEditing) {
      return path.to.consumableSupplier(itemId, id!);
    } else {
      return path.to.newConsumableSupplier(itemId);
    }
  }

  if (type === "Material") {
    if (isEditing) {
      return path.to.materialSupplier(itemId, id!);
    } else {
      return path.to.newMaterialSupplier(itemId);
    }
  }

  throw new Error("Invalid type");
}
