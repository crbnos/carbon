import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Copy,
  toast,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLocation, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { usePermissions, useUrlParams } from "~/hooks";
import { lookupBuyPrice as lookupBuyPriceAsync } from "~/modules/items";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { quoteOperationValidator } from "../../sales.models";
import { quoteMaterialValidator } from "../../sales.models";

type QuoteMaterialFormProps = {
  initialValues: z.infer<typeof quoteMaterialValidator> & {
    quoteMaterialMakeMethodId: string | null;
  };
  operations: z.infer<typeof quoteOperationValidator>[];
};

const QuoteMaterialForm = ({
  initialValues,
  operations
}: QuoteMaterialFormProps) => {
  const fetcher = useFetcher<{ id: string; methodType: MethodType }>();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();

  const { quoteId, lineId, materialId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");
  if (!materialId) throw new Error("materialId not found");

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.itemType
  );
  const [itemData, setItemData] = useState<{
    itemId: string;
    methodType: MethodType;
    description: string;
    unitCost: number;
    unitOfMeasureCode: string;
    quantity: number;
  }>({
    itemId: initialValues.itemId ?? "",
    methodType: initialValues.methodType ?? "Buy",
    description: initialValues.description ?? "",
    unitCost: initialValues.unitCost ?? 0,
    unitOfMeasureCode: initialValues.unitOfMeasureCode ?? "EA",
    quantity: initialValues.quantity ?? 1
  });

  const onTypeChange = (value: MethodItemType | "Item") => {
    if (value === itemType) return;
    setItemType(value as MethodItemType);
    setItemData({
      itemId: "",
      methodType: "" as "Buy",
      quantity: 1,
      description: "",
      unitCost: 0,
      unitOfMeasureCode: "EA"
    });
  };

  const lookupBuyPrice = useCallback(
    async (itemId: string, qty: number, fallbackCost: number) => {
      return lookupBuyPriceAsync(carbon, itemId, qty, fallbackCost);
    },
    [carbon]
  );

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;

    const [item, itemCost] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, unitOfMeasureCode, defaultMethodType"
        )
        .eq("id", itemId)
        .single(),
      carbon.from("itemCost").select("unitCost").eq("itemId", itemId).single()
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    let unitCost = itemCost.data?.unitCost ?? 0;
    const isBuyPart = item.data?.defaultMethodType === "Buy";

    if (isBuyPart) {
      unitCost = await lookupBuyPrice(itemId, itemData.quantity ?? 1, unitCost);
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitCost,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy"
    }));
  };

  const onQuantityChange = useCallback(
    async (newQty: number) => {
      setItemData((d) => ({ ...d, quantity: newQty }));

      if (itemData.methodType !== "Buy" || !itemData.itemId) return;
      if (!carbon) return;

      const itemCost = await carbon
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemData.itemId)
        .single();

      const fallbackCost = itemCost.data?.unitCost ?? 0;
      const unitCost = await lookupBuyPrice(
        itemData.itemId,
        newQty,
        fallbackCost
      );

      setItemData((d) => ({ ...d, unitCost }));
    },
    [carbon, itemData.methodType, itemData.itemId, lookupBuyPrice]
  );

  const [, setSearchParams] = useUrlParams();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    const newPath = path.to.quoteLineMakeMethod(
      quoteId,
      lineId,
      initialValues.quoteMaterialMakeMethodId!
    );

    setSearchParams({ materialId: initialValues.id ?? null });
    navigate(newPath);
  }, [
    fetcher.data,
    initialValues,
    initialValues.id,
    initialValues.methodType,
    initialValues.quoteMaterialMakeMethodId,
    lineId,
    location.pathname,
    navigate,
    quoteId
  ]);

  const [items] = useItems();
  const itemReadableId = getItemReadableId(items, itemData.itemId);

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.quoteMaterial(quoteId, lineId, initialValues?.id!)}
        defaultValues={initialValues}
        fetcher={fetcher}
        validator={quoteMaterialValidator}
      >
        <CardHeader>
          <CardTitle className="line-clamp-2">{itemData.description}</CardTitle>
          <CardDescription className="flex items-center gap-2">
            {itemReadableId} <Copy text={itemReadableId ?? ""} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="quoteMakeMethodId" />

          {itemData.methodType === "Make" && (
            <Hidden name="unitCost" value={itemData.unitCost} />
          )}
          <Hidden name="order" />
          <VStack className="pt-4">
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Item
                name="itemId"
                label={itemType}
                type={itemType}
                includeInactive
                onChange={(value) => {
                  onItemChange(value?.value as string);
                }}
                onTypeChange={onTypeChange}
              />
              <InputControlled
                name="description"
                label="Description"
                value={itemData.description}
                onChange={(newValue) => {
                  setItemData((d) => ({ ...d, description: newValue }));
                }}
              />
              <Select
                name="quoteOperationId"
                label="Operation"
                isClearable
                options={operations.map((o) => ({
                  value: o.id!,
                  label: o.description
                }))}
              />

              <DefaultMethodType
                name="methodType"
                label="Method Type"
                value={itemData.methodType}
                replenishmentSystem="Buy and Make"
              />
              <NumberControlled
                name="quantity"
                label="Quantity per Parent"
                value={itemData.quantity}
                onChange={onQuantityChange}
              />
              <UnitOfMeasure
                name="unitOfMeasureCode"
                value={itemData.unitOfMeasureCode}
                onChange={(newValue) =>
                  setItemData((d) => ({
                    ...d,
                    unitOfMeasureCode: newValue?.value ?? "EA"
                  }))
                }
              />
              {itemData.methodType !== "Make" && (
                <NumberControlled
                  name="unitCost"
                  label="Unit Cost"
                  value={itemData.unitCost}
                  minValue={0}
                />
              )}
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "sales")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteMaterialForm;
