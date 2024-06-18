import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack,
  cn,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import { BsDownload, BsThreeDotsVertical, BsUpload } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  Item,
  Select,
  SelectControlled,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { Quotation } from "~/modules/sales";
import { quotationLineValidator, quoteLineStatusType } from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationLineFormProps = {
  initialValues: z.infer<typeof quotationLineValidator>;
};

const QuotationLineForm = ({ initialValues }: QuotationLineFormProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { company } = useUser();
  const { supabase } = useSupabase();

  const { id } = useParams();

  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(id));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.quotation?.status ?? ""
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !isEditable
    ? true
    : isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    description: string;
    replenishmentSystem: string;
    uom: string;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    replenishmentSystem: initialValues.replenishmentSystem ?? "",
    uom: initialValues.unitOfMeasureCode ?? "",
  });

  const onItemChange = async (itemId: string) => {
    if (!supabase || !company.id) return;
    const [item, part] = await Promise.all([
      supabase
        .from("item")
        .select("name, readableId")
        .eq("id", itemId)
        .single(),
      supabase
        .from("part")
        .select("replenishmentSystem, unitOfMeasureCode")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .single(),
    ]);

    setItemData({
      itemId,
      itemReadableId: item.data?.readableId ?? "",
      description: item.data?.name ?? "",
      replenishmentSystem:
        part.data?.replenishmentSystem === "Buy and Make"
          ? ""
          : part.data?.replenishmentSystem ?? "",
      uom: part.data?.unitOfMeasureCode ?? "",
    });
  };

  return (
    <ValidatedForm
      defaultValues={initialValues}
      validator={quotationLineValidator}
      method="post"
      action={
        isEditing
          ? path.to.quoteLine(id, initialValues.id!)
          : path.to.newQuoteLine(id)
      }
      className="w-full"
    >
      <Card>
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>{isEditing ? "Quote Line" : "New Quote Line"}</CardTitle>
            <CardDescription>
              {isEditing
                ? itemData?.description
                : "A quote line contains pricing and lead times for a particular part"}
            </CardDescription>
          </CardHeader>
          <CardAction>
            {isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={<BsThreeDotsVertical />}
                    aria-label="More"
                    variant="secondary"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate("delete")}>
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Line
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <DropdownMenuIcon icon={<BsDownload />} />
                    Get Part
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <DropdownMenuIcon icon={<BsUpload />} />
                    Save Part
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Hidden name="intent" value="line" />
          <Hidden name="id" />
          <Hidden name="quoteId" />
          <Hidden name="itemReadableId" value={itemData?.itemReadableId} />
          <Hidden name="unitOfMeasureCode" value={itemData?.uom} />
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Item
                name="itemId"
                type="Part"
                label="Part"
                onChange={(value) => {
                  onItemChange(value?.value as string);
                }}
              />

              <InputControlled
                name="description"
                label="Description"
                value={itemData.description}
                onChange={(newValue) =>
                  setItemData((d) => ({ ...d, description: newValue }))
                }
              />

              <SelectControlled
                name="replenishmentSystem"
                label="Replenishment System"
                options={
                  itemData.replenishmentSystem === "Buy"
                    ? [{ label: "Buy", value: "Buy" }]
                    : itemData.replenishmentSystem === "Make"
                    ? [{ label: "Make", value: "Make" }]
                    : [
                        {
                          label: "Buy",
                          value: "Buy",
                        },
                        {
                          label: "Make",
                          value: "Make",
                        },
                      ]
                }
                value={itemData.replenishmentSystem}
                onChange={(newValue) => {
                  if (newValue)
                    setItemData((d) => ({
                      ...d,
                      replenishmentSystem: newValue?.value,
                    }));
                }}
              />

              <Input name="customerPartId" label="Customer Part ID" />
              <Input
                name="customerPartRevision"
                label="Customer Part Revision"
              />

              <Select
                name="status"
                label="Line Status"
                options={quoteLineStatusType.map((s) => ({
                  label: s,
                  value: s,
                }))}
                className={cn(!isEditing && "sr-only")}
              />

              <CustomFormFields table="quoteLine" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled}>Save</Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default QuotationLineForm;
