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
  Location,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isPurchaseReturnOrderLocked } from "../../purchasing.models";
import type { PurchaseReturnOrder } from "./types";

// The static `update` route segment outranks the `$id` param, so this
// resolves to routes/x+/purchase-return-order+/update.tsx.
const updateAction = path.to.purchaseReturnOrderUpdate;

const PurchaseReturnOrderProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    purchaseReturnOrder: PurchaseReturnOrder;
    lines: { itemId: string | null }[];
  }>(path.to.purchaseReturnOrder(id));

  const unlinkDisclosure = useDisclosure();

  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const { carbon } = useCarbon();
  const [purchaseOrderOptions, setPurchaseOrderOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const supplierId = routeData?.purchaseReturnOrder?.supplierId;
  const [linkedOrderLabel, setLinkedOrderLabel] = useState<string | null>(null);
  const linkedOrderId = routeData?.purchaseReturnOrder?.purchaseOrderId;
  useEffect(() => {
    if (!carbon || !linkedOrderId) {
      setLinkedOrderLabel(null);
      return;
    }
    carbon
      .from("purchaseOrder")
      .select("purchaseOrderId")
      .eq("id", linkedOrderId)
      .maybeSingle()
      .then(({ data }) => {
        setLinkedOrderLabel(data?.purchaseOrderId ?? null);
      });
  }, [carbon, linkedOrderId]);

  const lineItemIds = (routeData?.lines ?? [])
    .map((line) => line.itemId)
    .filter((itemId): itemId is string => Boolean(itemId));
  const lineItemKey = lineItemIds.sort().join(",");
  useEffect(() => {
    if (!carbon || !supplierId) return;
    // Only offer orders that actually contain the return's items. With no
    // lines yet, every order of the supplier is offered.
    const query =
      lineItemIds.length > 0
        ? carbon
            .from("purchaseOrder")
            .select("id, purchaseOrderId, purchaseOrderLine!inner(itemId)")
            .eq("supplierId", supplierId)
            .in("purchaseOrderLine.itemId", lineItemIds)
            .order("purchaseOrderId", { ascending: false })
        : carbon
            .from("purchaseOrder")
            .select("id, purchaseOrderId")
            .eq("supplierId", supplierId)
            .order("purchaseOrderId", { ascending: false });
    query.then(({ data }) => {
      setPurchaseOrderOptions(
        (data ?? []).map((order) => ({
          value: order.id,
          label: order.purchaseOrderId
        }))
      );
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: lineItemKey stands in for the array identity
  }, [carbon, supplierId, lineItemKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdate = useCallback(
    (field: keyof PurchaseReturnOrder, value: string | null) => {
      if (value === routeData?.purchaseReturnOrder[field]) {
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

    [id, routeData?.purchaseReturnOrder]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "purchaseReturnOrder");
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
    table: "purchaseReturnOrder"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.purchaseReturnOrder?.assignee;

  const canUpdate = permissions.can("update", "purchasing");
  const isLocked = isPurchaseReturnOrderLocked(
    routeData?.purchaseReturnOrder?.status
  );
  const isDisabled = !canUpdate || isLocked;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
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
                        path.to.purchaseReturnOrderDetails(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to supplier return</Trans>
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
                      routeData?.purchaseReturnOrder?.purchaseReturnOrderId ??
                        ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy return number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">
          {routeData?.purchaseReturnOrder?.purchaseReturnOrderId}
        </span>
      </VStack>

      {routeData?.purchaseReturnOrder?.purchaseOrderId ? (
        <VStack spacing={0} className="w-full">
          <span className="text-xs text-muted-foreground">
            <Trans>Purchase Order</Trans>
          </span>
          <HStack className="group w-full justify-between" spacing={0}>
            <Hyperlink
              to={path.to.purchaseOrder(
                routeData.purchaseReturnOrder.purchaseOrderId
              )}
            >
              <Badge variant="secondary">
                <RiProgress8Line className="w-3 h-3 mr-1" />
                {linkedOrderLabel ??
                  purchaseOrderOptions.find(
                    (option) =>
                      option.value ===
                      routeData.purchaseReturnOrder.purchaseOrderId
                  )?.label ??
                  t`Purchase Order`}
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
            <Trans>Purchase Order</Trans>
          </span>
          <Combobox
            size="sm"
            className="w-full"
            value=""
            options={purchaseOrderOptions}
            isReadOnly={isDisabled}
            placeholder={t`Link a purchase order`}
            onChange={(value) => {
              if (value) onUpdate("purchaseOrderId", value);
            }}
          />
        </VStack>
      )}

      <Assignee
        id={id}
        table="purchaseReturnOrder"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />

      <ValidatedForm
        defaultValues={{
          supplierId: routeData?.purchaseReturnOrder?.supplierId
        }}
        validator={z.object({
          supplierId: z.string().min(1, { message: "Supplier is required" })
        })}
        className="w-full"
      >
        <Supplier
          name="supplierId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("supplierId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          supplierReference:
            routeData?.purchaseReturnOrder?.supplierReference ?? undefined
        }}
        validator={z.object({
          supplierReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="supplierReference"
          label={t`Supplier RMA #`}
          isReadOnly={isDisabled}
          value={routeData?.purchaseReturnOrder?.supplierReference ?? ""}
          size="sm"
          inline
          onBlur={(e) => {
            onUpdate("supplierReference", e.target.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          supplierLocationId:
            routeData?.purchaseReturnOrder?.supplierLocationId ?? ""
        }}
        validator={z.object({
          supplierLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <SupplierLocation
          name="supplierLocationId"
          supplier={routeData?.purchaseReturnOrder?.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierLocation) => {
            if (supplierLocation?.id) {
              onUpdate("supplierLocationId", supplierLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          supplierContactId:
            routeData?.purchaseReturnOrder?.supplierContactId ?? ""
        }}
        validator={z.object({
          supplierContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <SupplierContact
          name="supplierContactId"
          label={t`Supplier Contact`}
          supplier={routeData?.purchaseReturnOrder?.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierContact) => {
            if (supplierContact?.id) {
              onUpdate("supplierContactId", supplierContact.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          orderDate: routeData?.purchaseReturnOrder?.orderDate ?? ""
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
          expirationDate: routeData?.purchaseReturnOrder?.expirationDate ?? ""
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
          locationId: routeData?.purchaseReturnOrder?.locationId ?? ""
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
          currencyCode:
            routeData?.purchaseReturnOrder?.currencyCode ?? undefined
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
          value={routeData?.purchaseReturnOrder?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.purchaseReturnOrder?.replacementPurchaseOrderId && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Replacement Order</Trans>
          </span>
          <Hyperlink
            to={path.to.purchaseOrder(
              routeData.purchaseReturnOrder.replacementPurchaseOrderId
            )}
          >
            <Trans>View replacement purchase order</Trans>
          </Hyperlink>
        </VStack>
      )}

      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar
          employeeId={routeData?.purchaseReturnOrder?.createdBy ?? null}
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
                <Trans>Unlink return from purchase order?</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This will remove the link between{" "}
                  {routeData?.purchaseReturnOrder?.purchaseReturnOrderId} and
                  its purchase order. The return will no longer appear under the
                  purchase order.
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
                  onUpdate("purchaseOrderId", null);
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
          (routeData?.purchaseReturnOrder?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="purchaseReturnOrder"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default PurchaseReturnOrderProperties;
