import { useCarbon } from "@carbon/auth";
import { Combobox, ValidatedForm } from "@carbon/form";
import type { TrackedEntityOption } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { Fragment, useState } from "react";
import {
  LuCirclePlus,
  LuCircleStop,
  LuLoaderCircle,
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
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
  /** Readable ids for already-picked entities no longer in returnableEntities */
  pickedEntityLabels?: Record<string, string>;
  /** Ids + readable ids for the linked source documents */
  linkage?: {
    receiptId?: string | null;
    receiptReadableId?: string | null;
    purchaseOrderId?: string | null;
    purchaseOrderReadableId?: string | null;
    purchaseInvoiceId?: string | null;
    purchaseInvoiceReadableId?: string | null;
  };
};

/** One subtle, linked reference to a source document in the line header. */
function SourceReference({
  to,
  label,
  value
}: {
  to: string;
  label: string;
  value: string;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="group inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground"
    >
      <span className="text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
      <span className="font-medium tabular-nums text-foreground/70 group-hover:text-foreground">
        {value}
      </span>
    </Link>
  );
}

const PurchaseReturnOrderLineForm = ({
  initialValues,
  type,
  onClose,
  line,
  returnReasons,
  returnableEntities,
  pickedEntityLabels,
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
      .then(({ data, error }) => {
        if (error) {
          toast.error(t`Failed to load return reasons`);
          return;
        }
        setReasons(data ?? []);
      });
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

  const isSerial = itemData.trackingType === "Serial";

  // Once the return is confirmed, the line's item, quantity, price, and
  // restocking fee are locked on the server (they set the credit basis and are
  // validated against source-line caps at Confirm). Reflect that in the UI so
  // the fields don't look editable while silently refusing to save. Return
  // reason and the serials/batches to send back stay editable — Reopen the
  // return to Draft to change anything locked.
  const areLineFieldsLocked = isEditing && status !== "Draft";

  // Source-document references shown under the line title — one subtle link
  // each, in place of the old badges.
  const sources = (
    [
      linkage?.receiptId && linkage?.receiptReadableId
        ? {
            to: path.to.receiptDetails(linkage.receiptId),
            label: t`Receipt`,
            value: linkage.receiptReadableId
          }
        : null,
      linkage?.purchaseOrderId && linkage?.purchaseOrderReadableId
        ? {
            to: path.to.purchaseOrderDetails(linkage.purchaseOrderId),
            label: t`Purchase Order`,
            value: linkage.purchaseOrderReadableId
          }
        : null,
      linkage?.purchaseInvoiceId && linkage?.purchaseInvoiceReadableId
        ? {
            to: path.to.purchaseInvoiceDetails(linkage.purchaseInvoiceId),
            label: t`Invoice`,
            value: linkage.purchaseInvoiceReadableId
          }
        : null
    ] as ({ to: string; label: string; value: string } | null)[]
  ).filter((source): source is { to: string; label: string; value: string } =>
    Boolean(source)
  );

  // Serials/batches get their own card — but only in the details (card) view of
  // a tracked, existing line. The modal/new flow keeps its selection inline.
  const showSerialsCard =
    type !== "modal" && isEditing && isTracked && !!returnableEntities;

  const formInner = (
    <>
      <ModalCardHeader>
        <ModalCardTitle>
          {isEditing ? (
            (line?.item?.readableIdWithRevision ?? <Trans>Line</Trans>)
          ) : (
            <Trans>New Line</Trans>
          )}
        </ModalCardTitle>
        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-sm">
            {sources.map((source, index) => (
              <Fragment key={source.label}>
                {index > 0 && (
                  <span className="text-muted-foreground/50">·</span>
                )}
                <SourceReference
                  to={source.to}
                  label={source.label}
                  value={source.value}
                />
              </Fragment>
            ))}
          </div>
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
        {/* When the serials card isn't shown (untracked item, or the modal/new
            flow) the selection's hidden inputs live here so it still submits. */}
        {!showSerialsCard &&
          selectedEntityIds.map((entityId) => (
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
            isReadOnly={areLineFieldsLocked}
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
          />
          <Number
            name="quantity"
            label={t`Return Quantity`}
            minValue={0}
            step={INPUT_STEP.quantity}
            isReadOnly={areLineFieldsLocked}
          />
          <NumberControlled
            name="unitPrice"
            label={t`Unit Price`}
            value={itemData.unitPrice}
            formatOptions={INPUT_FORMAT.rate(currencyCode, currencyDecimals)}
            isReadOnly={areLineFieldsLocked}
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
            isReadOnly={areLineFieldsLocked}
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
                  line?.closedComplete ? <LuLoaderCircle /> : <LuCircleStop />
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
    </>
  );

  const serialsCard = showSerialsCard ? (
    <Card>
      <CardHeader>
        <CardTitle>
          {isSerial ? (
            <Trans>Serial numbers to return</Trans>
          ) : (
            <Trans>Batches to return</Trans>
          )}
        </CardTitle>
        <CardDescription>
          {isSerial ? (
            <Trans>
              Pick the serial numbers on hand that were received from this
              supplier.
            </Trans>
          ) : (
            <Trans>
              Pick the batches on hand that were received from this supplier.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {selectedEntityIds.map((entityId) => (
          <input
            key={entityId}
            type="hidden"
            name="trackedEntityIds"
            value={entityId}
          />
        ))}
        <VStack spacing={4} className="items-start">
          {selectedEntityIds.length > 0 ? (
            <HStack spacing={2} className="flex-wrap">
              {selectedEntityIds.map((entityId) => (
                <Badge
                  key={entityId}
                  variant="secondary"
                  className="gap-1 py-1 pr-1 pl-2.5 tabular-nums"
                >
                  {entityById.get(entityId)?.readableId ??
                    pickedEntityLabels?.[entityId] ??
                    entityId}
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
            </HStack>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isSerial ? (
                <Trans>No serial numbers selected yet.</Trans>
              ) : (
                <Trans>No batches selected yet.</Trans>
              )}
            </p>
          )}
          <Button
            leftIcon={<LuCirclePlus />}
            variant="secondary"
            size="sm"
            isDisabled={isLocked || pickerEntities.length === 0}
            onClick={pickerDisclosure.onOpen}
          >
            <Trans>Add</Trans>
          </Button>
        </VStack>
      </CardContent>
    </Card>
  ) : null;

  return (
    <ModalCardProvider type={type}>
      {type === "modal" ? (
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
              {formInner}
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      ) : (
        <ValidatedForm
          defaultValues={initialValues}
          validator={purchaseReturnOrderLineValidator}
          method="post"
          action={
            isEditing
              ? path.to.purchaseReturnOrderLine(orderId, initialValues.id!)
              : path.to.newPurchaseReturnOrderLine(orderId)
          }
          className="flex w-full flex-col gap-4"
          isDisabled={isEditing && isLocked}
        >
          <ModalCard isCollapsible={isEditing}>
            <ModalCardContent size="xxlarge">{formInner}</ModalCardContent>
          </ModalCard>
          {serialsCard}
        </ValidatedForm>
      )}
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
