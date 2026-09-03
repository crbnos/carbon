import { useCarbon } from "@carbon/auth";
import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Combobox,
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
import { useCallback, useEffect, useState } from "react";
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

  const lineItemIds = (routeData?.lines ?? [])
    .map((line) => line.itemId)
    .filter((itemId): itemId is string => Boolean(itemId));
  const lineItemKey = lineItemIds.sort().join(",");
  useEffect(() => {
    if (!carbon || !customerId) return;
    // Only offer orders that actually contain the RMA's items — linking to
    // an order that never sold these items would be meaningless. With no
    // lines yet, every order of the customer is offered.
    const query =
      lineItemIds.length > 0
        ? carbon
            .from("salesOrder")
            .select("id, salesOrderId, salesOrderLine!inner(itemId)")
            .eq("customerId", customerId)
            .in("salesOrderLine.itemId", lineItemIds)
            .order("salesOrderId", { ascending: false })
        : carbon
            .from("salesOrder")
            .select("id, salesOrderId")
            .eq("customerId", customerId)
            .order("salesOrderId", { ascending: false });
    query.then(({ data }) => {
      setSalesOrderOptions(
        (data ?? []).map((order) => ({
          value: order.id,
          label: order.salesOrderId
        }))
      );
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: lineItemKey stands in for the array identity
  }, [carbon, customerId, lineItemKey]);

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
      className="w-96 bg-background h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
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

      {routeData?.salesReturnOrder?.salesOrderId ? (
        <VStack spacing={0} className="w-full">
          <span className="text-xs text-muted-foreground">
            <Trans>Sales Order</Trans>
          </span>
          <HStack className="group w-full justify-between" spacing={0}>
            <Hyperlink
              to={path.to.salesOrder(routeData.salesReturnOrder.salesOrderId)}
            >
              <Badge variant="secondary">
                <RiProgress8Line className="w-3 h-3 mr-1" />
                {linkedOrderLabel ??
                  salesOrderOptions.find(
                    (option) =>
                      option.value === routeData.salesReturnOrder.salesOrderId
                  )?.label ??
                  t`Sales Order`}
              </Badge>
            </Hyperlink>
            {!isDisabled && (
              <Button
                className="group-hover:opacity-100 opacity-0 transition-opacity duration-200"
                variant="ghost"
                size="sm"
                leftIcon={<LuUnlink2 className="w-3 h-3" />}
                onClick={unlinkDisclosure.onOpen}
              >
                <Trans>Unlink</Trans>
              </Button>
            )}
          </HStack>
        </VStack>
      ) : (
        <VStack spacing={0} className="w-full">
          <span className="text-xs text-muted-foreground">
            <Trans>Sales Order</Trans>
          </span>
          <Combobox
            size="sm"
            className="w-full"
            value=""
            options={salesOrderOptions}
            isReadOnly={isDisabled}
            placeholder={t`Link a sales order`}
            onChange={(value) => {
              if (value) onUpdate("salesOrderId", value);
            }}
          />
        </VStack>
      )}

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
