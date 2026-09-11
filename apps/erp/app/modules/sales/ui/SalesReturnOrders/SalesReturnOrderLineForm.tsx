import { useCarbon } from "@carbon/auth";
import { Combobox, ValidatedForm } from "@carbon/form";
import {
  Button,
  Select as CarbonSelect,
  FormControl,
  FormLabel,
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useMount
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
import { LuCircleStop, LuLoaderCircle } from "react-icons/lu";
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
  isSalesReturnOrderLocked,
  salesReturnDispositionType,
  salesReturnOrderLineValidator
} from "../../sales.models";
import type { SalesReturnOrder, SalesReturnOrderLine } from "./types";

type SalesReturnOrderLineFormProps = {
  initialValues: z.infer<typeof salesReturnOrderLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
  /** Full line row when editing (drives disposition, short close, tracking) */
  line?: SalesReturnOrderLine;
  /** Return reasons from the route loader; fetched on mount when absent */
  returnReasons?: { id: string; name: string }[];
  /** Ids + readable ids for the linked source documents */
  linkage?: {
    shipmentId?: string | null;
    shipmentReadableId?: string | null;
    salesOrderId?: string | null;
    salesOrderReadableId?: string | null;
    salesInvoiceId?: string | null;
    salesInvoiceReadableId?: string | null;
  };
};

/** One subtle reference to a source document in the line header — a navigable
 * link when its id is known, plain text when only the readable id is. */
function SourceReference({
  to,
  label,
  value
}: {
  to?: string;
  label: string;
  value: string;
}) {
  if (!to) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground/70">
          {value}
        </span>
      </span>
    );
  }

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

const SalesReturnOrderLineForm = ({
  initialValues,
  type,
  onClose,
  line,
  returnReasons,
  linkage
}: SalesReturnOrderLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { id: orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
  }>(path.to.salesReturnOrder(orderId));

  const isLocked = isSalesReturnOrderLocked(
    routeData?.salesReturnOrder?.status
  );
  const status = routeData?.salesReturnOrder?.status;
  const isEditing = initialValues.id !== undefined;

  const currencyCode =
    routeData?.salesReturnOrder?.currencyCode ??
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

    const customerId = routeData?.salesReturnOrder?.customerId;

    // Manually added (blind) lines resolve their credit-basis price through
    // the pricing engine — customer overrides, quantity breaks, and price
    // rules included — matching the sales-order line form. Linked lines keep
    // the source document's price and never pass through here.
    const resolvedPrice = customerId
      ? await (async () => {
          try {
            const response = await fetch(path.to.api.salesResolvePrice, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customerId,
                itemId,
                quantity: globalThis.Number(initialValues.quantity) || 1
              })
            });
            if (response.ok) {
              const result = await response.json();
              // the Number FORM COMPONENT import shadows the global here
              return globalThis.Number(result.finalPrice);
            }
          } catch {
            // fall through to the base price below
          }
          return null;
        })()
      : null;

    const [item, price] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, unitOfMeasureCode, itemTrackingType"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      resolvedPrice === null
        ? carbon
            .from("itemUnitSalePrice")
            .select("unitSalePrice")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

    if (item.error) {
      toast.error(t`Failed to load item data`);
      return;
    }

    setItemData({
      itemId,
      uom: item.data?.unitOfMeasureCode ?? "EA",
      trackingType: item.data?.itemTrackingType ?? "Inventory",
      unitPrice: resolvedPrice ?? price.data?.unitSalePrice ?? 0
    });
  };

  // Disposition submits through its own fetcher, not the line form. Scrap and
  // Rework escalate to an Issue instead of writing the disposition directly.
  const dispositionFetcher = useFetcher<{ success: boolean }>();
  const [disposition, setDisposition] = useState(
    (line?.disposition as string | undefined) ?? "Pending"
  );
  // The disposition routes always redirect (success or flashed error), so the
  // loader's revalidated value is the persisted truth — sync the select to it.
  // A failed submit reverts; a successful one confirms the same value.
  useEffect(() => {
    if (dispositionFetcher.state === "idle" && line?.disposition) {
      setDisposition(line.disposition as string);
    }
  }, [dispositionFetcher.state, line?.disposition]);
  const quantityReceived = line?.quantityReceived ?? 0;

  const onDispositionChange = (value: string) => {
    if (!line?.id) return;
    setDisposition(value);
    const formData = new FormData();
    formData.append("lineId", line.id);
    formData.append("disposition", value);
    dispositionFetcher.submit(formData, {
      method: "post",
      action:
        value === "Scrap" || value === "Rework"
          ? path.to.salesReturnOrderLineIssue(orderId, line.id)
          : path.to.salesReturnOrderLineDisposition(orderId, line.id)
    });
  };

  // Short close ("stop expecting") toggles closedComplete on the line
  const receivingFetcher = useFetcher<{ success: boolean }>();
  const canShortClose =
    isEditing &&
    !!line &&
    status !== "Draft" &&
    !isLocked &&
    (line.quantityReceived ?? 0) < (line.quantity ?? 0);

  const onToggleReceiving = () => {
    if (!line?.id) return;
    const formData = new FormData();
    formData.append("intent", line.closedComplete ? "reopen" : "close");
    receivingFetcher.submit(formData, {
      method: "post",
      action: path.to.salesReturnOrderLineReceiving(orderId, line.id)
    });
  };

  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  // Once the return is confirmed, the line's item, quantity, price, and
  // restocking fee are locked on the server (they set the credit basis and are
  // validated against source-line caps at Confirm). Reflect that in the UI so
  // the fields don't look editable while silently refusing to save. Return
  // reason and disposition stay editable — Reopen the return to Draft to change
  // anything locked.
  const areLineFieldsLocked = isEditing && status !== "Draft";

  // Source-document references shown under the line title — one subtle link
  // each, in place of the old badges.
  const sources = (
    [
      linkage?.shipmentReadableId
        ? {
            to: linkage.shipmentId
              ? path.to.shipmentDetails(linkage.shipmentId)
              : undefined,
            label: t`Shipment`,
            value: linkage.shipmentReadableId
          }
        : null,
      linkage?.salesOrderReadableId
        ? {
            to: linkage.salesOrderId
              ? path.to.salesOrderDetails(linkage.salesOrderId)
              : undefined,
            label: t`Sales Order`,
            value: linkage.salesOrderReadableId
          }
        : null,
      linkage?.salesInvoiceReadableId
        ? {
            to: linkage.salesInvoiceId
              ? path.to.salesInvoiceDetails(linkage.salesInvoiceId)
              : undefined,
            label: t`Invoice`,
            value: linkage.salesInvoiceReadableId
          }
        : null
    ] as ({ to?: string; label: string; value: string } | null)[]
  ).filter((source): source is { to?: string; label: string; value: string } =>
    Boolean(source)
  );

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose} isCollapsible={isEditing}>
        <ModalCardContent size="xxlarge">
          <ValidatedForm
            defaultValues={initialValues}
            validator={salesReturnOrderLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.salesReturnOrderLine(orderId, initialValues.id!)
                : path.to.newSalesReturnOrderLine(orderId)
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
              <Hidden name="salesReturnOrderId" />
              <Hidden name="unitOfMeasureCode" value={itemData.uom} />
              {initialValues.salesOrderLineId && (
                <Hidden name="salesOrderLineId" />
              )}
              {initialValues.shipmentLineId && <Hidden name="shipmentLineId" />}
              {initialValues.salesInvoiceLineId && (
                <Hidden name="salesInvoiceLineId" />
              )}
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
                  formatOptions={INPUT_FORMAT.rate(
                    currencyCode,
                    currencyDecimals
                  )}
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
                {isEditing && line && (
                  <FormControl>
                    <FormLabel>
                      <Trans>Disposition</Trans>
                    </FormLabel>
                    <CarbonSelect
                      value={disposition}
                      onValueChange={onDispositionChange}
                      disabled={
                        quantityReceived === 0 ||
                        // Not isLocked: full receipt auto-completes the RMA,
                        // and disposition happens after goods arrive.
                        status === "Cancelled" ||
                        !permissions.can("update", "sales") ||
                        dispositionFetcher.state !== "idle"
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t`Select disposition`} />
                      </SelectTrigger>
                      <SelectContent>
                        {salesReturnDispositionType.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </CarbonSelect>
                  </FormControl>
                )}
                <CustomFormFields table="salesReturnOrderLine" />
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
                        line?.closedComplete ? (
                          <LuLoaderCircle />
                        ) : (
                          <LuCircleStop />
                        )
                      }
                      isLoading={receivingFetcher.state !== "idle"}
                      isDisabled={
                        receivingFetcher.state !== "idle" ||
                        !permissions.can("update", "sales")
                      }
                      onClick={onToggleReceiving}
                    >
                      {line?.closedComplete ? (
                        <Trans>Resume Receiving</Trans>
                      ) : (
                        <Trans>Stop Receiving</Trans>
                      )}
                    </Button>
                  )}
                </HStack>
              </HStack>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default SalesReturnOrderLineForm;
