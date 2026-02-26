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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
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
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import type { z } from "zod";
import { EditableNumber } from "~/components/Editable";
import {
  ConversionFactor,
  CustomFormFields,
  Hidden,
  Input,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Submit,
  Supplier,
  UnitOfMeasure
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { supplierPartValidator } from "../../items.models";

type PriceBreak = {
  quantity: number;
  unitPrice: number;
  sourceType: string;
  sourceDocumentId: string | null;
  createdAt: string;
};

type PriceBreakRow = {
  quantity: number;
  unitPrice: number;
};

type PurchaseHistoryItem = {
  id: string;
  purchaseQuantity: number | null;
  unitPrice: number | null;
  purchaseOrderId: string;
  purchaseOrder: {
    purchaseOrderId: string;
    supplierId: string;
    orderDate: string | null;
  };
};

type SupplierPartFormProps = {
  initialValues: z.infer<typeof supplierPartValidator>;
  type: "Part" | "Service" | "Tool" | "Consumable" | "Material";
  unitOfMeasureCode: string;
  priceBreaks?: PriceBreak[];
  purchasingHistory?: PurchaseHistoryItem[];
  onClose: () => void;
};

const SupplierPartForm = ({
  initialValues,
  type,
  unitOfMeasureCode,
  priceBreaks: initialPriceBreaks = [],
  purchasingHistory = [],
  onClose
}: SupplierPartFormProps) => {
  const permissions = usePermissions();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  let { itemId } = useParams();

  if (!itemId) {
    itemId = initialValues.itemId;
  }

  const [purchaseUnitOfMeasure, setPurchaseUnitOfMeasure] = useState<
    string | undefined
  >(initialValues.supplierUnitOfMeasureCode);

  const [priceBreaks, setPriceBreaks] = useState<PriceBreakRow[]>(
    initialPriceBreaks.map((pb) => ({
      quantity: pb.quantity,
      unitPrice: pb.unitPrice
    }))
  );

  const hasInvalidPriceBreaks = priceBreaks.some(
    (pb) => pb.quantity <= 0 || pb.unitPrice <= 0
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const action = getAction(isEditing, type, itemId, initialValues.id);
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success, fetcher.data?.message, onClose]);

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
              {isEditing ? "Edit" : "New"} Supplier Part
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="itemId" />
            <Hidden name="priceBreaks" value={JSON.stringify(priceBreaks)} />

            <VStack spacing={4}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
                <Supplier name="supplierId" label="Supplier" />
                <Input name="supplierPartId" label="Supplier Part ID" />
                <Number
                  name="unitPrice"
                  label="Unit Price"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />
                <UnitOfMeasure
                  name="supplierUnitOfMeasureCode"
                  label="Unit of Measure"
                  onChange={(value) => {
                    if (value) setPurchaseUnitOfMeasure(value.value);
                  }}
                />
                <ConversionFactor
                  name="conversionFactor"
                  label="Conversion Factor"
                  inventoryCode={unitOfMeasureCode ?? undefined}
                  purchasingCode={purchaseUnitOfMeasure}
                />
                <Number
                  name="minimumOrderQuantity"
                  label="Minimum Order Quantity"
                  minValue={0}
                />
                <CustomFormFields table="partSupplier" />
              </div>
              <PriceBreaks
                priceBreaks={priceBreaks}
                onChange={setPriceBreaks}
                baseCurrency={baseCurrency}
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
                  fetcher.state !== "idle"
                }
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                Save
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
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
  if (history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase History</CardTitle>
        <CardDescription>
          <span className="text-sm text-muted-foreground">
            {history.length} order{history.length !== 1 ? "s" : ""}
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
                        {line.purchaseOrder.orderDate
                          ? formatDate(line.purchaseOrder.orderDate)
                          : "—"}
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
                              {new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency: baseCurrency
                              }).format(line.unitPrice ?? 0)}
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

function PriceBreaks({
  priceBreaks,
  onChange,
  baseCurrency,
  isDisabled
}: {
  priceBreaks: PriceBreakRow[];
  onChange: React.Dispatch<React.SetStateAction<PriceBreakRow[]>>;
  baseCurrency: string;
  isDisabled: boolean;
}) {
  const formatter = useCurrencyFormatter();

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => [...prev, { quantity: 0, unitPrice: 0 }]);
  }, [onChange]);

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: PriceBreakRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(noOpMutation),
      unitPrice: EditableNumber(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const columns = useMemo<ColumnDef<PriceBreakRow>[]>(
    () => [
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[80px]">
            <span>{row.original.quantity}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Price break actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => removeRow(row.index)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Price Break
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => formatter.format(row.original.unitPrice)
      }
    ],
    [isDisabled, removeRow, formatter]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">Price Breaks</span>
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
