import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  InputControlled,
  Number,
  NumberControlled,
  Part,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { Quotation } from "~/modules/sales";
import { quotationMaterialValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationMaterialFormProps = {
  initialValues: z.infer<typeof quotationMaterialValidator>;
};

const QuotationMaterialForm = ({
  initialValues,
}: QuotationMaterialFormProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const { company } = useUser();
  const navigate = useNavigate();

  const { id, lineId, operationId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");
  if (!operationId) throw new Error("operationId not found");

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(id));
  const isEditable = ["Draft"].includes(routeData?.quotation?.status ?? "");

  const [partData, setPartData] = useState<{
    itemId: string;
    description: string;
    unitCost: number;
    uom: string;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    unitCost: initialValues.unitCost ?? 0,
    uom: initialValues.unitOfMeasureCode ?? "",
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !isEditable
    ? true
    : isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  const onClose = () => navigate(-1);

  const onPartChange = async (itemId: string) => {
    if (!supabase || !company.id) return;
    const [item, part, cost] = await Promise.all([
      supabase
        .from("item")
        .select("name")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("part")
        .select("unitOfMeasureCode")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .single(),
    ]);

    setPartData({
      itemId,
      description: item.data?.name ?? "",
      unitCost: cost.data?.unitCost ?? 0,
      uom: part.data?.unitOfMeasureCode ?? "EA",
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={quotationMaterialValidator}
          method="post"
          action={
            isEditing
              ? path.to.quoteMaterial(
                  id,
                  lineId,
                  operationId,
                  initialValues.id!
                )
              : path.to.newQuoteMaterial(id, lineId, operationId)
          }
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Material</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <VStack spacing={4}>
              <Part
                name="itemId"
                label="Part"
                itemReplenishmentSystem="Buy"
                onChange={(value) => {
                  onPartChange(value?.value as string);
                }}
              />

              <InputControlled
                name="description"
                label="Description"
                value={partData.description}
                onChange={(newValue) =>
                  setPartData((d) => ({ ...d, description: newValue }))
                }
              />

              <Number name="quantity" label="Quantity" />
              {/* 
                  // TODO: implement this and replace the UoM in PartForm */}
              {/* <UnitOfMeasure name="unitOfMeasureCode" label="Unit of Measure" value={uom} /> */}
              <NumberControlled
                name="unitCost"
                label="Unit Cost"
                value={partData.unitCost}
                onChange={(value) =>
                  setPartData((d) => ({
                    ...d,
                    unitCost: value,
                  }))
                }
              />
              <CustomFormFields table="quoteMaterial" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
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

export default QuotationMaterialForm;
