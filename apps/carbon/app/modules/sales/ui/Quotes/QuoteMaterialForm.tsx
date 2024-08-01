import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  toast,
  VStack,
} from "@carbon/react";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  Number,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { useOptimisticLocation, usePermissions } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { quoteOperationValidator } from "~/modules/sales";
import { quoteMaterialValidator } from "~/modules/sales";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { path } from "~/utils/path";

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
  const { supabase } = useSupabase();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useOptimisticLocation();

  const { quoteId, lineId, materialId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");
  if (!materialId) throw new Error("materialId not found");

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.itemType
  );
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    methodType: MethodType;
    description: string;
    unitOfMeasureCode: string;
    quantity: number;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    methodType: initialValues.methodType ?? "Buy",
    description: initialValues.description ?? "",
    unitOfMeasureCode: initialValues.unitOfMeasureCode ?? "EA",
    quantity: initialValues.quantity ?? 1,
  });

  const onTypeChange = (value: MethodItemType) => {
    setItemType(value);
    setItemData({
      itemId: "",
      itemReadableId: "",
      methodType: "" as "Buy",
      quantity: 1,
      description: "",
      unitOfMeasureCode: "EA",
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!supabase) return;

    const item = await supabase
      .from("item")
      .select("name, readableId, unitOfMeasureCode, defaultMethodType")
      .eq("id", itemId)
      .single();

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      itemReadableId: initialValues?.itemReadableId ?? "",
      description: initialValues?.description ?? "",
      unitOfMeasureCode: initialValues?.unitOfMeasureCode ?? "EA",
      methodType: initialValues?.methodType ?? "Buy",
    }));
  };

  useEffect(() => {
    const newPath =
      initialValues.methodType === "Make"
        ? path.to.quoteLineMaterialMake(
            quoteId,
            lineId,
            initialValues.quoteMaterialMakeMethodId!,
            initialValues.id!
          )
        : path.to.quoteLineMaterial(
            quoteId,
            lineId,
            initialValues.methodType.toLowerCase(),
            initialValues.id!
          );
    if (fetcher.data && location.pathname !== newPath) {
      navigate(newPath);
    }
  }, [
    fetcher.data,
    initialValues.id,
    initialValues.methodType,
    initialValues.quoteMaterialMakeMethodId,
    lineId,
    location.pathname,
    navigate,
    quoteId,
  ]);

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
          <CardTitle>{itemData.itemReadableId}</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="quoteMakeMethodId" />
          <Hidden name="itemReadableId" value={itemData.itemReadableId} />
          <Hidden name="order" />
          <VStack className="pt-4">
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Select
                name="itemType"
                label="Type"
                options={methodItemType.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(value) => {
                  onTypeChange(value?.value as MethodItemType);
                }}
              />
              <Item
                name="itemId"
                label={itemType}
                type={itemType}
                onChange={(value) => {
                  onItemChange(value?.value as string);
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
            </div>
            <InputControlled
              name="description"
              label="Description"
              value={itemData.description}
              onChange={(newValue) => {
                setItemData((d) => ({ ...d, description: newValue }));
              }}
            />
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
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
