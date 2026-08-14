import { useCarbon } from "@carbon/auth";
import { Combobox, ValidatedForm } from "@carbon/form";
import type { TrackedEntityOption } from "@carbon/react";
import {
  Badge,
  Button,
  FormLabel,
  HStack,
  IconButton,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  TrackedEntityPicker,
  toast,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCirclePlus,
  LuCircleStop,
  LuLoaderCircle,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Item,
  Number,
  NumberControlled,
  Submit
} from "~/components/Form";
import {
  useCurrencyDecimals,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import {
  isPurchaseReturnOrderLocked,
  purchaseReturnOrderLineValidator
} from "../../purchasing.models";
import type {
  PurchaseReturnOrder,
  PurchaseReturnOrderLine,
  ReturnableEntity
} from "./types";

type PurchaseReturnOrderLineFormProps = {
  initialValues: z.infer<typeof purchaseReturnOrderLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
  /** Full line row when editing (drives short close and tracking) */
  line?: PurchaseReturnOrderLine;
  /** Return reasons from the route loader; fetched on mount when absent */
  returnReasons?: { id: string; name: string }[];
  /** Available serials/batches on hand received from this supplier */
  returnableEntities?: ReturnableEntity[];
  /** Readable ids for the linked source documents */
  linkage?: {
    receiptReadableId?: string | null;
    purchaseOrderReadableId?: string | null;
    purchaseInvoiceReadableId?: string | null;
  };
};

const PurchaseReturnOrderLineForm = ({
  initialValues,
  type,
  onClose,
  line,
  returnReasons,
  returnableEntities,
  linkage
}: PurchaseReturnOrderLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { id: orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    purchaseReturnOrder: PurchaseReturnOrder;
  }>(path.to.purchaseReturnOrder(orderId));

  const isLocked = isPurchaseReturnOrderLocked(
    routeData?.purchaseReturnOrder?.status
  );
  const status = routeData?.purchaseReturnOrder?.status;
  const supplierId = routeData?.purchaseReturnOrder?.supplierId;
  const isEditing = initialValues.id !== undefined;

  const currencyCode =
    routeData?.purchaseReturnOrder?.currencyCode ??
    company?.baseCurrencyCode ??
    "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const [itemData, setItemData] = useState<{
    itemId: string;
    uom: string;
    trackingType: string;
    unitPrice: number;
  }>({
    itemId: initialValues.itemId ?? "",
    uom: initialValues.unitOfMeasureCode ?? "",
    trackingType: line?.item?.itemTrackingType ?? "Inventory",
    unitPrice: initialValues.unitPrice ?? 0
  });

  const [reasons, setReasons] = useState(returnReasons ?? []);
  useMount(() => {
    if (returnReasons || !carbon || !company.id) return;
    carbon
      .from("returnReason")
      .select("id, name")
      .eq("companyId", company.id)
      .order("name")
      .then(({ data }) => setReasons(data ?? []));
  });

  const onItemChange = async (itemId: string) => {
    if (!itemId) return;
    if (!carbon || !company.id) return;

    const [item, supplierPart] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, unitOfMeasureCode, itemTrackingType"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supplierId
        ? carbon
            .from("supplierPart")
            .select("unitPrice, conversionFactor")
            .eq("itemId", itemId)
            .eq("supplierId", supplierId)
            .eq("companyId", company.id)
            .limit(1)
        : Promise.resolve({ data: null, error: null })
    ]);

    if (item.error) {
      toast.error(t`Failed to load item data`);
      return;
    }

    // supplierPart prices are per purchase unit — the line stores inventory
    // units, so divide by the conversion factor.
    const part = supplierPart.data?.[0];
    const conversionFactor = part?.conversionFactor ?? 1;
    const unitPrice =
      conversionFactor > 0
        ? (part?.unitPrice ?? 0) / conversionFactor
        : (part?.unitPrice ?? 0);

    setItemData({
      itemId,
      uom: item.data?.unitOfMeasureCode ?? "EA",
      trackingType: item.data?.itemTrackingType ?? "Inventory",
      unitPrice
    });
  };

  // Short close ("stop shipping") toggles closedComplete on the line
  const shippingFetcher = useFetcher<{ success: boolean }>();
  const canShortClose =
    isEditing &&
    !!line &&
    status !== "Draft" &&
    !isLocked &&
    (line.quantityShipped ?? 0) < (line.quantity ?? 0);

  const onToggleShipping = () => {
    if (!line?.id) return;
    const formData = new FormData();
    formData.append("intent", line.closedComplete ? "reopen" : "close");
    shippingFetcher.submit(formData, {
      method: "post",
      action: path.to.purchaseReturnOrderLineReceiving(orderId, line.id)
    });
  };

  // Serials/batches to send back for Serial/Batch items
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>(
    initialValues.trackedEntityIds ?? []
  );
  const pickerDisclosure = useDisclosure();
  const isTracked = ["Serial", "Batch"].includes(itemData.trackingType);
  const entityById = new Map(
    (returnableEntities ?? []).map((entity) => [entity.id, entity])
  );
  const pickerEntities: TrackedEntityOption[] = (returnableEntities ?? [])
    .filter((entity) => !selectedEntityIds.includes(entity.id))
    .map((entity) => ({
      trackedEntityId: entity.id,
      readableId: entity.readableId,
      availableQuantity: entity.quantity ?? 1
    }));

  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose} isCollapsible={isEditing}>
        <ModalCardContent size="xxlarge">
          <ValidatedForm
            defaultValues={initialValues}
            validator={purchaseReturnOrderLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.purchaseReturnOrderLine(orderId, initialValues.id!)
                : path.to.newPurchaseReturnOrderLine(orderId)
            }
            className="w-full"
            isDisabled={isEditing && isLocked}
            onSubmit={() => {
              if (type === "modal") onClose?.();
            }}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? (
                  (line?.item?.readableIdWithRevision ?? <Trans>Line</Trans>)
                ) : (
                  <Trans>New Line</Trans>
                )}
              </ModalCardTitle>
              {(linkage?.receiptReadableId ||
                linkage?.purchaseOrderReadableId ||
                linkage?.purchaseInvoiceReadableId) && (
                <HStack spacing={2} className="pt-2">
                  {linkage?.receiptReadableId && (
                    <Badge variant="secondary">
                      <Trans>Receipt</Trans> {linkage.receiptReadableId}
                    </Badge>
                  )}
                  {linkage?.purchaseOrderReadableId && (
                    <Badge variant="secondary">
                      <Trans>Purchase Order</Trans>{" "}
                      {linkage.purchaseOrderReadableId}
                    </Badge>
                  )}
                  {linkage?.purchaseInvoiceReadableId && (
                    <Badge variant="secondary">
                      <Trans>Invoice</Trans> {linkage.purchaseInvoiceReadableId}
                    </Badge>
                  )}
                </HStack>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="id" />
              <Hidden name="purchaseReturnOrderId" />
              <Hidden name="unitOfMeasureCode" value={itemData.uom} />
              {initialValues.purchaseOrderLineId && (
                <Hidden name="purchaseOrderLineId" />
              )}
              {initialValues.receiptLineId && <Hidden name="receiptLineId" />}
              {initialValues.purchaseInvoiceLineId && (
                <Hidden name="purchaseInvoiceLineId" />
              )}
              {selectedEntityIds.map((entityId) => (
                <input
                  key={entityId}
                  type="hidden"
                  name="trackedEntityIds"
                  value={entityId}
                />
              ))}
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                <Item
                  name="itemId"
                  label={t`Item`}
                  type="Item"
                  value={itemData.itemId}
                  onChange={(value) => {
                    onItemChange(value?.value as string);
                  }}
                />
                <Number
                  name="quantity"
                  label={t`Return Quantity`}
                  minValue={0}
                  step={INPUT_STEP.quantity}
                />
                <NumberControlled
                  name="unitPrice"
                  label={t`Unit Price`}
                  value={itemData.unitPrice}
                  formatOptions={INPUT_FORMAT.rate(
                    currencyCode,
                    currencyDecimals
                  )}
                  onChange={(value) =>
                    setItemData((d) => ({
                      ...d,
                      unitPrice: value
                    }))
                  }
                />
                <Number
                  name="restockFeePercent"
                  label={t`Restock Fee Percent`}
                  minValue={0}
                  maxValue={1}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percent}
                />
                <Combobox
                  name="returnReasonId"
                  label={t`Return Reason`}
                  options={reasons.map((reason) => ({
                    value: reason.id,
                    label: reason.name
                  }))}
                />
                <CustomFormFields table="purchaseReturnOrderLine" />
              </div>

              {isEditing && isTracked && returnableEntities && (
                <VStack spacing={2} className="pt-4">
                  <FormLabel>
                    <Trans>Serials/batches to return</Trans>
                  </FormLabel>
                  <HStack spacing={2} className="flex-wrap">
                    {selectedEntityIds.map((entityId) => (
                      <Badge key={entityId} variant="secondary">
                        {entityById.get(entityId)?.readableId ?? entityId}
                        <IconButton
                          aria-label={t`Remove`}
                          icon={<LuX />}
                          size="sm"
                          variant="ghost"
                          isDisabled={isLocked}
                          onClick={() =>
                            setSelectedEntityIds((ids) =>
                              ids.filter((id) => id !== entityId)
                            )
                          }
                        />
                      </Badge>
                    ))}
                    <Button
                      leftIcon={<LuCirclePlus />}
                      variant="secondary"
                      size="sm"
                      isDisabled={isLocked || pickerEntities.length === 0}
                      onClick={pickerDisclosure.onOpen}
                    >
                      <Trans>Add</Trans>
                    </Button>
                  </HStack>
                </VStack>
              )}
            </ModalCardBody>
            <ModalCardFooter>
              <HStack className="w-full justify-between">
                <HStack>
                  <Submit isDisabled={isDisabled || (isEditing && isLocked)}>
                    <Trans>Save</Trans>
                  </Submit>
                  {canShortClose && (
                    <Button
                      variant="secondary"
                      leftIcon={
                        line?.closedComplete ? (
                          <LuLoaderCircle />
                        ) : (
                          <LuCircleStop />
                        )
                      }
                      isLoading={shippingFetcher.state !== "idle"}
                      isDisabled={
                        shippingFetcher.state !== "idle" ||
                        !permissions.can("update", "purchasing")
                      }
                      onClick={onToggleShipping}
                    >
                      {line?.closedComplete ? (
                        <Trans>Resume Shipping</Trans>
                      ) : (
                        <Trans>Stop Shipping</Trans>
                      )}
                    </Button>
                  )}
                </HStack>
              </HStack>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
      {pickerDisclosure.isOpen && (
        <TrackedEntityPicker
          trackingType={itemData.trackingType === "Serial" ? "Serial" : "Batch"}
          entities={pickerEntities}
          title={t`Pick serials/batches to return`}
          description={t`Serials and batches on hand that were received from this supplier`}
          onSelect={(selection) => {
            setSelectedEntityIds((ids) =>
              ids.includes(selection.trackedEntityId)
                ? ids
                : [...ids, selection.trackedEntityId]
            );
            pickerDisclosure.onClose();
          }}
          onClose={pickerDisclosure.onClose}
        />
      )}
    </ModalCardProvider>
  );
};

export default PurchaseReturnOrderLineForm;
