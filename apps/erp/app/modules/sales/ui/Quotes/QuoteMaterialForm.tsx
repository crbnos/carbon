import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Copy,
  toast,
  VStack,
} from "@carbon/react";
import {
  useFetcher,
  useLocation,
  useNavigate,
  useParams,
} from "@remix-run/react";

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  Number,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { useBom, useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
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
  operations,
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
    quantity: initialValues.quantity ?? 1,
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
      unitOfMeasureCode: "EA",
    });
  };

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
      carbon.from("itemCost").select("unitCost").eq("itemId", itemId).single(),
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitCost: itemCost.data?.unitCost ?? 0,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
    }));
  };

  const [, setSelectedMaterialId] = useBom();

  useEffect(() => {
    const newPath = path.to.quoteLineMakeMethod(
      quoteId,
      lineId,
      initialValues.quoteMaterialMakeMethodId!
    );

    setSelectedMaterialId(initialValues.id ?? null);
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
    quoteId,
    setSelectedMaterialId,
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
                  label: o.description,
                }))}
              />

              <DefaultMethodType
                name="methodType"
                label="Method Type"
                value={itemData.methodType}
                replenishmentSystem="Buy and Make"
              />
              <Number name="quantity" label="Quantity per Parent" />
              <UnitOfMeasure
                name="unitOfMeasureCode"
                value={itemData.unitOfMeasureCode}
                onChange={(newValue) =>
                  setItemData((d) => ({
                    ...d,
                    unitOfMeasureCode: newValue?.value ?? "EA",
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
