import { useCarbon } from "@carbon/auth";
import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Combobox,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { LuCopy, LuLink, LuX } from "react-icons/lu";
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
  }>(path.to.purchaseReturnOrder(id));

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
  useEffect(() => {
    if (!carbon || !supplierId) return;
    carbon
      .from("purchaseOrder")
      .select("id, purchaseOrderId")
      .eq("supplierId", supplierId)
      .order("purchaseOrderId", { ascending: false })
      .then(({ data }) => {
        setPurchaseOrderOptions(
          (data ?? []).map((order) => ({
            value: order.id,
            label: order.purchaseOrderId
          }))
        );
      });
  }, [carbon, supplierId]);

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

      <VStack spacing={2} className="w-full">
        <span className="text-xs text-muted-foreground">
          <Trans>Purchase Order</Trans>
        </span>
        <HStack className="w-full" spacing={1}>
          <Combobox
            size="sm"
            className="w-full"
            value={routeData?.purchaseReturnOrder?.purchaseOrderId ?? ""}
            options={purchaseOrderOptions}
            isReadOnly={isDisabled}
            placeholder={t`Link a purchase order`}
            onChange={(value) => {
              if (value) onUpdate("purchaseOrderId", value);
            }}
          />
          {routeData?.purchaseReturnOrder?.purchaseOrderId && !isDisabled && (
            <IconButton
              aria-label={t`Unlink purchase order`}
              icon={<LuX />}
              size="sm"
              variant="ghost"
              onClick={() => onUpdate("purchaseOrderId", null)}
            />
          )}
        </HStack>
      </VStack>

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

      {routeData?.purchaseReturnOrder?.purchaseOrderId && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Source Purchase Order</Trans>
          </span>
          <Hyperlink
            to={path.to.purchaseOrder(
              routeData.purchaseReturnOrder.purchaseOrderId
            )}
          >
            {purchaseOrderOptions.find(
              (option) =>
                option.value === routeData.purchaseReturnOrder.purchaseOrderId
            )?.label ?? <Trans>View source purchase order</Trans>}
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
