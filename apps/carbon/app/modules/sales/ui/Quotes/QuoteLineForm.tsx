import {
  CardAction,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
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
import { methodType } from "~/modules/items";
import type { Quotation } from "~/modules/sales";
import { quoteLineStatusType, quoteLineValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuoteLineFormProps = {
  initialValues: z.infer<typeof quoteLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const QuoteLineForm = ({
  initialValues,
  type,
  onClose,
}: QuoteLineFormProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { company } = useUser();
  const { supabase } = useSupabase();

  const { quoteId } = useParams();

  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(quoteId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.quotation?.status ?? ""
  );

  const isEditing = initialValues.id !== undefined;

  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    description: string;
    methodType: string;
    uom: string;
    modelUploadId: string | null;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    methodType: initialValues.methodType ?? "",
    uom: initialValues.unitOfMeasureCode ?? "",
    modelUploadId: initialValues.modelUploadId ?? null,
  });

  const onItemChange = async (itemId: string) => {
    if (!supabase || !company.id) return;
    const [item] = await Promise.all([
      supabase
        .from("item")
        .select(
          "name, readableId, defaultMethodType, unitOfMeasureCode, modelUploadId"
        )
        .eq("id", itemId)
        .single(),
    ]);

    setItemData({
      itemId,
      itemReadableId: item.data?.readableId ?? "",
      description: item.data?.name ?? "",
      methodType: item.data?.defaultMethodType ?? "",
      uom: item.data?.unitOfMeasureCode ?? "",
      modelUploadId: item.data?.modelUploadId ?? null,
    });
  };

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            defaultValues={initialValues}
            validator={quoteLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.quoteLine(quoteId, initialValues.id!)
                : path.to.newQuoteLine(quoteId)
            }
            className="w-full"
            onSubmit={() => {
              if (type === "modal") onClose?.();
            }}
          >
            <HStack className="w-full justify-between items-start">
              <ModalCardHeader>
                <ModalCardTitle>
                  {isEditing ? "Quote Line" : "New Quote Line"}
                </ModalCardTitle>
                <ModalCardDescription>
                  {isEditing
                    ? itemData?.description
                    : "A quote line contains pricing and lead times for a particular part"}
                </ModalCardDescription>
              </ModalCardHeader>
              {isEditing && (
                <CardAction>
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
                </CardAction>
              )}
            </HStack>
            <ModalCardBody>
              <Hidden name="intent" value="line" />
              <Hidden name="id" />
              <Hidden name="quoteId" />
              <Hidden name="itemReadableId" value={itemData?.itemReadableId} />
              <Hidden name="unitOfMeasureCode" value={itemData?.uom} />
              <Hidden
                name="modelUploadId"
                value={itemData?.modelUploadId ?? undefined}
              />
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
                    name="methodType"
                    label="Method"
                    options={
                      methodType.map((m) => ({
                        label: m,
                        value: m,
                      })) ?? []
                    }
                    value={itemData.methodType}
                    onChange={(newValue) => {
                      if (newValue)
                        setItemData((d) => ({
                          ...d,
                          methodType: newValue?.value,
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
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isDisabled={
                  !isEditable || isEditing
                    ? !permissions.can("update", "sales")
                    : !permissions.can("create", "sales")
                }
              >
                Save
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default QuoteLineForm;
