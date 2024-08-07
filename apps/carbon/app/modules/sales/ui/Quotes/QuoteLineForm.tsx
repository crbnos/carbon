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
  useDisclosure,
  VStack,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  ArrayNumeric,
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
import type { Quotation, QuotationLine } from "~/modules/sales";
import {
  DeleteQuoteLine,
  quoteLineStatusType,
  quoteLineValidator,
} from "~/modules/sales";
import { methodType } from "~/modules/shared";
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

  const deleteDisclosure = useDisclosure();

  return (
    <>
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
                    {isEditing
                      ? itemData?.itemReadableId ?? "Quote Line"
                      : "New Quote Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing
                      ? itemData?.description
                      : "A quote line contains pricing and lead times for a particular part"}
                  </ModalCardDescription>
                </ModalCardHeader>
                {isEditing && permissions.can("update", "sales") && (
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
                        <DropdownMenuItem onClick={deleteDisclosure.onOpen}>
                          <DropdownMenuIcon icon={<LuTrash />} />
                          Delete Line
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardAction>
                )}
              </HStack>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="quoteId" />
                <Hidden
                  name="itemReadableId"
                  value={itemData?.itemReadableId}
                />
                <Hidden name="unitOfMeasureCode" value={itemData?.uom} />
                <Hidden
                  name="modelUploadId"
                  value={itemData?.modelUploadId ?? undefined}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                    <div className="col-span-2 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                      <Item
                        name="itemId"
                        type="Part"
                        label="Part"
                        includeInactive
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

                      <Select
                        name="status"
                        label="Line Status"
                        options={quoteLineStatusType.map((s) => ({
                          label: s,
                          value: s,
                        }))}
                      />

                      <Input name="customerPartId" label="Customer Part ID" />
                      <Input
                        name="customerPartRevision"
                        label="Customer Part Revision"
                      />

                      <CustomFormFields table="quoteLine" />
                    </div>
                    <div className="flex gap-y-4">
                      <ArrayNumeric
                        name="quantity"
                        label="Quantity"
                        defaults={[1, 25, 50, 100]}
                      />
                    </div>
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
      {isEditing && deleteDisclosure.isOpen && (
        <DeleteQuoteLine
          line={initialValues as QuotationLine}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default QuoteLineForm;
