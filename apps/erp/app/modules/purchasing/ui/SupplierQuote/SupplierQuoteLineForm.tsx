import { useCarbon } from "@carbon/auth";
import { DatePicker, ValidatedForm } from "@carbon/form";
import {
  Badge,
  CardAction,
  cn,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuBox, LuReceipt, LuTrash } from "react-icons/lu";
import { useParams } from "react-router";
import type { z } from "zod";
import {
  Account,
  ArrayNumeric,
  ConversionFactor,
  CostCenter,
  CustomFormFields,
  Hidden,
  InputControlled,
  Item,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";

import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import {
  isSupplierQuoteLocked,
  supplierQuoteLineValidator
} from "../../purchasing.models";
import type { SupplierQuote } from "../../types";
import DeleteSupplierQuoteLine from "./DeleteSupplierQuoteLine";

type SupplierQuoteLineFormProps = {
  initialValues: z.infer<typeof supplierQuoteLineValidator> & {
    itemType: MethodItemType;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const SupplierQuoteLineForm = ({
  initialValues,
  type,
  onClose
}: SupplierQuoteLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const { id } = useParams();

  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));

  const isLocked = isSupplierQuoteLocked(routeData?.quote?.status);

  const isEditing = initialValues.id !== undefined;
  const isGLAccount = initialValues.supplierQuoteLineType === "G/L Account";
  const [activeTab, setActiveTab] = useState<"direct" | "indirect">(
    isGLAccount ? "indirect" : "direct"
  );

  const [indirectData, setIndirectData] = useState<{
    accountId: string;
    costCenterId: string;
    description: string;
    requiredDate: string | null;
  }>({
    accountId: initialValues.accountId ?? "",
    costCenterId: initialValues.costCenterId ?? "",
    description: initialValues.description ?? "",
    requiredDate: initialValues.requiredDate ?? null
  });

  const [itemType, setItemType] = useState(initialValues.itemType);
  const [itemData, setItemData] = useState<{
    supplierPartId: string;
    description: string;
    itemId: string;
    inventoryUom: string;
    purchaseUom: string;
    conversionFactor: number;
  }>({
    supplierPartId: initialValues.supplierPartId ?? "",
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1
  });

  const onSupplierPartChange = async (supplierPartId: string) => {
    if (!carbon || !routeData?.quote?.supplierId) return;

    const supplierPart = await carbon
      .from("supplierPart")
      .select("supplierPartId, itemId")
      .eq("supplierPartId", supplierPartId)
      .eq("supplierId", routeData?.quote?.supplierId!)
      .maybeSingle();

    if (supplierPart.error) {
      toast.error(t`Failed to load supplier part details`);
      return;
    }

    if (supplierPart.data && supplierPart.data.itemId && !itemData.itemId) {
      onItemChange(supplierPart.data.itemId);
    }
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;

    const [item, supplierPart] = await Promise.all([
      carbon
        .from("item")
        .select("name, readableIdWithRevision, type, unitOfMeasureCode")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("supplierPart")
        .select("supplierPartId, supplierUnitOfMeasureCode, conversionFactor")
        .eq("itemId", itemId)
        .eq("supplierId", routeData?.quote?.supplierId!)
        .maybeSingle()
    ]);

    if (item.error) {
      toast.error(t`Failed to load item details`);
      return;
    }

    const newItemData = {
      ...itemData,
      itemId,
      itemReadableId: item.data?.readableIdWithRevision ?? "",
      description: item.data?.name ?? "",
      inventoryUom: item.data?.unitOfMeasureCode ?? "EA",
      purchaseUom:
        supplierPart.data?.supplierUnitOfMeasureCode ??
        item.data?.unitOfMeasureCode ??
        "EA",
      conversionFactor: supplierPart.data?.conversionFactor ?? 1
    };

    if (supplierPart.data && !itemData.supplierPartId) {
      newItemData.supplierPartId = supplierPart.data.supplierPartId ?? "";
    }

    setItemData(newItemData);
    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const deleteDisclosure = useDisclosure();

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "direct" | "indirect")}
        className="w-full"
      >
        <ModalCardProvider type={type}>
          <ModalCard
            onClose={onClose}
            defaultCollapsed={false}
            isCollapsible={isEditing}
          >
            <ModalCardContent size="xxlarge">
              <ValidatedForm
                defaultValues={initialValues}
                validator={supplierQuoteLineValidator}
                method="post"
                action={
                  isEditing
                    ? path.to.supplierQuoteLine(id, initialValues.id!)
                    : path.to.newSupplierQuoteLine(id)
                }
                className="w-full"
                isDisabled={isEditing && isLocked}
                onSubmit={() => {
                  if (type === "modal") onClose?.();
                }}
              >
                <HStack
                  className={cn(
                    "w-full justify-between items-start",
                    type === "modal" && "pr-16",
                    type !== "modal" && isEditing && "pr-6"
                  )}
                >
                  <ModalCardHeader className="flex flex-1">
                    <ModalCardTitle>
                      {isEditing
                        ? "Supplier Quote Line"
                        : "New Supplier Quote Line"}
                    </ModalCardTitle>
                    <ModalCardDescription>
                      {isEditing ? (
                        <div className="flex flex-col items-start gap-1">
                          <span>{itemData?.description}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {initialValues?.quantity.join(", ")}
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        "A quote line contains pricing and lead times for a particular part"
                      )}
                    </ModalCardDescription>
                  </ModalCardHeader>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isEditing && (
                      <TabsList>
                        <TabsTrigger value="direct">
                          <LuBox className="mr-1" />
                          <Trans>Direct</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="indirect">
                          <LuReceipt className="mr-1" />
                          <Trans>Indirect</Trans>
                        </TabsTrigger>
                      </TabsList>
                    )}
                    {isEditing &&
                      !isLocked &&
                      permissions.can("update", "purchasing") && (
                        <CardAction>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                icon={<BsThreeDotsVertical />}
                                aria-label={t`More`}
                                variant="ghost"
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                destructive
                                onClick={deleteDisclosure.onOpen}
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                <Trans>Delete Line</Trans>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </CardAction>
                      )}
                  </div>
                </HStack>
                <ModalCardBody>
                  <Hidden name="id" />
                  <Hidden name="supplierQuoteId" />

                  <TabsContent value="direct">
                    <Hidden name="supplierQuoteLineType" value={itemType} />
                    <Hidden
                      name="inventoryUnitOfMeasureCode"
                      value={itemData?.inventoryUom}
                    />
                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        <div className="col-span-2 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                          <Item
                            autoFocus
                            name="itemId"
                            label={t`Part`}
                            type={itemType}
                            value={itemData.itemId}
                            includeInactive
                            onChange={(value) => {
                              onItemChange(value?.value as string);
                            }}
                            onTypeChange={(type) => {
                              setItemType(type as MethodItemType);
                              setItemData({
                                ...itemData,
                                itemId: "",
                                description: "",
                                inventoryUom: "",
                                purchaseUom: "",
                                conversionFactor: 1,
                                supplierPartId: ""
                              });
                            }}
                          />

                          <InputControlled
                            name="description"
                            label={t`Short Description`}
                            value={itemData.description}
                          />

                          <InputControlled
                            name="supplierPartId"
                            label={t`Supplier Part Number`}
                            termId="supplier-part-id"
                            value={itemData.supplierPartId}
                            onChange={(newValue) => {
                              setItemData((d) => ({
                                ...d,
                                supplierPartId: newValue
                              }));
                            }}
                            onBlur={(e) => onSupplierPartChange(e.target.value)}
                          />
                          <UnitOfMeasure
                            name="purchaseUnitOfMeasureCode"
                            label={t`Purchase Unit of Measure`}
                            termId="item-purchasing-uom"
                            value={itemData.purchaseUom}
                            onChange={(newValue) => {
                              if (newValue) {
                                setItemData((d) => ({
                                  ...d,
                                  purchaseUom: newValue?.value as string
                                }));
                              }
                            }}
                          />
                          <ConversionFactor
                            name="conversionFactor"
                            termId="conversion-factor"
                            purchasingCode={itemData.purchaseUom}
                            inventoryCode={itemData.inventoryUom}
                            value={itemData.conversionFactor}
                            onChange={(value) => {
                              setItemData((d) => ({
                                ...d,
                                conversionFactor: value
                              }));
                            }}
                          />

                          <CustomFormFields table="supplierQuoteLine" />
                        </div>
                        <div className="flex gap-y-4">
                          <ArrayNumeric
                            name="quantity"
                            label={t`Quantity`}
                            termId="quantity-breaks"
                            defaults={[1, 25, 50, 100]}
                            isDisabled={isLocked}
                          />
                        </div>
                      </div>
                    </VStack>
                  </TabsContent>

                  <TabsContent value="indirect">
                    <Hidden name="supplierQuoteLineType" value="G/L Account" />
                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        <div className="col-span-2 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                          <Account
                            name="accountId"
                            label={t`GL Account`}
                            termId="purchase-indirect-gl-account"
                            classes={["Asset", "Expense"]}
                            isOptional={false}
                          />

                          <InputControlled
                            label={t`Description`}
                            name="description"
                            value={indirectData.description}
                            isOptional={false}
                            onChange={(newValue) =>
                              setIndirectData((d) => ({
                                ...d,
                                description: newValue
                              }))
                            }
                          />
                          <CostCenter
                            name="costCenterId"
                            label={t`Cost Center`}
                            termId="cost-center"
                            isOptional
                          />
                          <DatePicker
                            name="requiredDate"
                            label={t`Required Date`}
                            value={indirectData.requiredDate ?? undefined}
                            onChange={(date) => {
                              setIndirectData((d) => ({
                                ...d,
                                requiredDate: date
                              }));
                            }}
                          />
                          <CustomFormFields table="supplierQuoteLine" />
                        </div>
                        <div className="flex gap-y-4">
                          <ArrayNumeric
                            name="quantity"
                            label={t`Quantity`}
                            defaults={[1, 25, 50, 100]}
                            isDisabled={isLocked}
                          />
                        </div>
                      </div>
                    </VStack>
                  </TabsContent>
                </ModalCardBody>
                <ModalCardFooter>
                  <Submit
                    isDisabled={
                      isLocked ||
                      (isEditing
                        ? !permissions.can("update", "purchasing")
                        : !permissions.can("create", "purchasing"))
                    }
                  >
                    <Trans>Save</Trans>
                  </Submit>
                </ModalCardFooter>
              </ValidatedForm>
            </ModalCardContent>
          </ModalCard>
        </ModalCardProvider>
      </Tabs>
      {isEditing && deleteDisclosure.isOpen && initialValues.id && (
        <DeleteSupplierQuoteLine
          line={{
            itemId: itemData.itemId ?? "",
            id: initialValues.id
          }}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default SupplierQuoteLineForm;
