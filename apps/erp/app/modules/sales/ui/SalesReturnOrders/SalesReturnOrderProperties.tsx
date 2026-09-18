import { useCarbon } from "@carbon/auth";
import type { Json } from "@carbon/database";
import {
  Combobox as ComboboxField,
  DatePicker,
  InputControlled,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCopy, LuLink, LuUnlink2 } from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Assignee,
  EmployeeAvatar,
  Hyperlink,
  useOptimisticAssignment
} from "~/components";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  Location
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isSalesReturnOrderLocked } from "../../sales.models";
import type { SalesReturnOrder } from "./types";

// path.ts has no bulkUpdateSalesReturnOrder helper yet; the static `update`
// route segment outranks the `$id` param, so this resolves to
// routes/x+/sales-return-order+/update.tsx.
const updateAction = path.to.salesReturnOrderUpdate;

// Inline preview for the Sales Order field, matching the badge the linked
// state renders so switching between linked and unlinked doesn't reflow.
const SalesOrderPreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const label = options.find((option) => option.value === value)?.label;
  return (
    <Hyperlink to={path.to.salesOrder(value)}>
      <Badge variant="secondary">
        <RiProgress8Line className="w-3 h-3 mr-1" />
        {label ?? value}
      </Badge>
    </Hyperlink>
  );
};

const SalesReturnOrderProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
    lines: { itemId: string | null }[];
  }>(path.to.salesReturnOrder(id));

  const unlinkDisclosure = useDisclosure();

  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const { carbon } = useCarbon();
  const [salesOrderOptions, setSalesOrderOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const customerId = routeData?.salesReturnOrder?.customerId;
  const [linkedOrderLabel, setLinkedOrderLabel] = useState<string | null>(null);
  const linkedOrderId = routeData?.salesReturnOrder?.salesOrderId;
  useEffect(() => {
    if (!carbon || !linkedOrderId) {
      setLinkedOrderLabel(null);
      return;
    }
    carbon
      .from("salesOrder")
      .select("salesOrderId")
      .eq("id", linkedOrderId)
      .maybeSingle()
      .then(({ data }) => {
        setLinkedOrderLabel(data?.salesOrderId ?? null);
      });
  }, [carbon, linkedOrderId]);

  // Every order for the customer is offered. An earlier version filtered to
  // orders containing the RMA's items via `salesOrderLine!inner(itemId)`,
  // which silently emptied the list as soon as the RMA had a line the order
  // didn't match — including every blind return, whose items may legitimately
  // have come from a different order. The link is convenience context, not a
  // costing input, so an over-broad list beats an empty one.
  useEffect(() => {
    if (!carbon || !customerId) {
      setSalesOrderOptions([]);
      return;
    }
    let cancelled = false;
    carbon
      .from("salesOrder")
      .select("id, salesOrderId")
      .eq("customerId", customerId)
      .order("salesOrderId", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(t`Failed to load sales orders`);
          setSalesOrderOptions([]);
          return;
        }
        setSalesOrderOptions(
          (data ?? []).map((order) => ({
            value: order.id,
            label: order.salesOrderId
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, customerId, t]);

  // The linked order may not be in the list query's results yet (or at all, if
  // it was later reassigned to another customer). Keep it in the options so the
  // inline preview resolves a readable label instead of falling back to the id.
  const salesOrderOptionsWithLinked = useMemo(() => {
    if (!linkedOrderId) return salesOrderOptions;
    if (salesOrderOptions.some((option) => option.value === linkedOrderId)) {
      return salesOrderOptions;
    }
    return [
      { value: linkedOrderId, label: linkedOrderLabel ?? linkedOrderId },
      ...salesOrderOptions
    ];
  }, [salesOrderOptions, linkedOrderId, linkedOrderLabel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdate = useCallback(
    (field: keyof SalesReturnOrder, value: string | null) => {
      if (value === routeData?.salesReturnOrder[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: updateAction
      });
    },

    [id, routeData?.salesReturnOrder]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "salesReturnOrder");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [id]
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "salesReturnOrder"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.salesReturnOrder?.assignee;

  const canUpdate = permissions.can("update", "sales");
  const isLocked = isSalesReturnOrderLocked(
    routeData?.salesReturnOrder?.status
  );
  const isDisabled = !canUpdate || isLocked;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Link`}
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin +
                        path.to.salesReturnOrderDetails(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to RMA</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy`}
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      routeData?.salesReturnOrder?.salesReturnOrderId ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy RMA number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">
          {routeData?.salesReturnOrder?.salesReturnOrderId}
        </span>
      </VStack>

      {/* One control for both states. The linked badge is the Combobox's own
          inline preview, so picking an order swaps the label in place instead
          of flipping to a differently-shaped read-only row once the fetcher
          lands. Clearing routes through the unlink confirmation. */}
      <ValidatedForm
        key={linkedOrderId ?? "unlinked"}
        defaultValues={{ salesOrderId: linkedOrderId ?? "" }}
        validator={z.object({
          salesOrderId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <ComboboxField
          name="salesOrderId"
          label={t`Sales Order`}
          options={salesOrderOptionsWithLinked}
          inline={SalesOrderPreview}
          isOptional
          isReadOnly={isDisabled}
          placeholder={t`Link a sales order`}
          onChange={(option) => {
            if (option?.value) {
              onUpdate("salesOrderId", option.value);
            } else if (linkedOrderId) {
              unlinkDisclosure.onOpen();
            }
          }}
        />
      </ValidatedForm>

      <Assignee
        id={id}
        table="salesReturnOrder"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />

      <ValidatedForm
        defaultValues={{ customerId: routeData?.salesReturnOrder?.customerId }}
        validator={z.object({
          customerId: z.string().min(1, { message: "Customer is required" })
        })}
        className="w-full"
      >
        <Customer
          name="customerId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("customerId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerReference:
            routeData?.salesReturnOrder?.customerReference ?? undefined
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label={t`Customer Reference`}
          isReadOnly={isDisabled}
          value={routeData?.salesReturnOrder?.customerReference ?? ""}
          size="sm"
          inline
          onBlur={(e) => {
            onUpdate("customerReference", e.target.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerLocationId:
            routeData?.salesReturnOrder?.customerLocationId ?? ""
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerLocation
          name="customerLocationId"
          customer={routeData?.salesReturnOrder?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerLocation) => {
            if (customerLocation?.id) {
              onUpdate("customerLocationId", customerLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerContactId:
            routeData?.salesReturnOrder?.customerContactId ?? ""
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          label={t`Customer Contact`}
          customer={routeData?.salesReturnOrder?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerContact) => {
            if (customerContact?.id) {
              onUpdate("customerContactId", customerContact.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          orderDate: routeData?.salesReturnOrder?.orderDate ?? ""
        }}
        validator={z.object({
          orderDate: z.string().min(1, { message: "Order date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="orderDate"
          label={t`Order Date`}
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("orderDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          expirationDate: routeData?.salesReturnOrder?.expirationDate ?? ""
        }}
        validator={z.object({
          expirationDate: z.string()
        })}
        className="w-full"
      >
        <DatePicker
          name="expirationDate"
          label={t`Expiration Date`}
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("expirationDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          locationId: routeData?.salesReturnOrder?.locationId ?? ""
        }}
        validator={z.object({
          locationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Location
          label={t`Return Location`}
          name="locationId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          currencyCode: routeData?.salesReturnOrder?.currencyCode ?? undefined
        }}
        validator={z.object({
          currencyCode: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Currency
          name="currencyCode"
          label={t`Currency`}
          inline
          value={routeData?.salesReturnOrder?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.salesReturnOrder?.replacementSalesOrderId && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Replacement Order</Trans>
          </span>
          <Hyperlink
            to={path.to.salesOrder(
              routeData.salesReturnOrder.replacementSalesOrderId
            )}
          >
            <Trans>View replacement sales order</Trans>
          </Hyperlink>
        </VStack>
      )}

      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar
          employeeId={routeData?.salesReturnOrder?.createdBy ?? null}
        />
      </VStack>

      {unlinkDisclosure.isOpen && (
        <Modal
          open={unlinkDisclosure.isOpen}
          onOpenChange={(open) => {
            if (!open) unlinkDisclosure.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Unlink RMA from sales order?</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This will remove the link between{" "}
                  {routeData?.salesReturnOrder?.salesReturnOrderId} and its
                  sales order. The RMA will no longer appear under the sales
                  order.
                </Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={unlinkDisclosure.onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="destructive"
                leftIcon={<LuUnlink2 className="w-3 h-3" />}
                onClick={() => {
                  onUpdate("salesOrderId", null);
                  unlinkDisclosure.onClose();
                }}
              >
                <Trans>Unlink</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <CustomFormInlineFields
        customFields={
          (routeData?.salesReturnOrder?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="salesReturnOrder"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default SalesReturnOrderProperties;
