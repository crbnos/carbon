import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  toast,
  VStack,
} from "@carbon/react";
import {
  useFetcher,
  useLocation,
  useNavigate,
  useParams,
} from "@remix-run/react";

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
import { useSupabase } from "~/lib/supabase";
import type { quoteOperationValidator } from "~/modules/sales";
import { quoteMaterialValidator } from "~/modules/sales";
import type { MethodItemType, MethodType } from "~/modules/shared";
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
    itemReadableId: string;
    methodType: MethodType;
    description: string;
    unitCost: number;
    unitOfMeasureCode: string;
    quantity: number;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    methodType: initialValues.methodType ?? "Buy",
    description: initialValues.description ?? "",
    unitCost: initialValues.unitCost ?? 0,
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
      unitCost: 0,
      unitOfMeasureCode: "EA",
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!supabase) return;

    const [item, itemCost] = await await Promise.all([
      supabase
        .from("item")
        .select("name, readableId, unitOfMeasureCode, defaultMethodType")
        .eq("id", itemId)
        .single(),
      supabase
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemId)
        .single(),
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      itemReadableId: item.data?.readableId ?? "",
      description: item.data?.name ?? "",
      unitCost: itemCost.data?.unitCost ?? 0,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
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
            initialValues.quoteMakeMethodId,
            initialValues.id!
          );
    if (
      fetcher.data?.methodType === "Make" &&
      !location.pathname.includes("make")
    ) {
      navigate(newPath);
    }

    if (
      fetcher.data?.methodType === "Buy" &&
      !location.pathname.includes("buy")
    ) {
      navigate(newPath);
    }

    if (
      fetcher.data?.methodType === "Pick" &&
      !location.pathname.includes("pick")
    ) {
      navigate(newPath);
    }
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
