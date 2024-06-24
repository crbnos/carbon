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
  InputControlled,
  Number,
  Part,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUrlParams, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { Quotation } from "~/modules/sales";
import { quotationAssemblyValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationAssemblyFormValues = z.infer<typeof quotationAssemblyValidator>;

type QuotationAssemblyFormProps = {
  initialValues: QuotationAssemblyFormValues;
};

const QuotationAssemblyForm = ({
  initialValues,
}: QuotationAssemblyFormProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { company } = useUser();
  const { supabase } = useSupabase();

  const { id: quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const [params] = useUrlParams();
  const parentAssemblyId = params.get("parentAssemblyId");

  const isEditing = initialValues.id !== undefined;

  const [partData, setPartData] = useState<{
    itemId: string;
    description: string;
    uom: string;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    uom: initialValues.unitOfMeasureCode ?? "",
  });

  const onPartChange = async (itemId: string) => {
    if (!supabase || !company.id) return;
    const [item, part] = await Promise.all([
      supabase
        .from("item")
        .select("name")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("part")
        .select("replenishmentSystem, unitOfMeasureCode")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
    ]);

    setPartData({
      itemId,
      description: item.data?.name ?? "",
      uom: part.data?.unitOfMeasureCode ?? "",
    });
  };

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(quoteId));
  const isEditable = ["Draft"].includes(routeData?.quotation?.status ?? "");

  return (
    <ValidatedForm
      method="post"
      validator={quotationAssemblyValidator}
      defaultValues={initialValues}
      className="w-full"
      action={
        isEditing
          ? path.to.quoteAssembly(quoteId, lineId, initialValues.id!)
          : path.to.newQuoteAssembly(quoteId, lineId)
      }
    >
      <Card>
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>{isEditing ? "Assembly" : "New Assembly"}</CardTitle>
            <CardDescription>
              {isEditing
                ? partData?.itemId
                : "A quote assembly is a collection of operations, materials, and subassemblies that are used to build a product."}
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
                    Delete Assembly
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
          <Hidden name="id" />
          <Hidden
            name="parentAssemblyId"
            value={parentAssemblyId ?? undefined}
          />
          <Hidden name="unitOfMeasureCode" value={partData?.uom} />
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Part
                name="itemId"
                label="Manufactured Part"
                itemReplenishmentSystem="Make"
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

              <Number
                name="quantityPerParent"
                label="Quantity per Parent"
                minValue={0}
              />
              <CustomFormFields table="quoteAssembly" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isEditable ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default QuotationAssemblyForm;
