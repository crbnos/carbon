import type { Json } from "@carbon/database";
import { CreatableMultiSelect, DatePicker, ValidatedForm } from "@carbon/form";
import {
  Avatar,
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, useOptimisticAssignment } from "~/components";
import { Employee, Location } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isRfqEditable } from "../../purchasing.models";
import type { PurchasingRFQ, PurchasingRFQSupplier } from "../../types";
import { SupplierForm } from "../Supplier";

const PurchasingRFQProperties = () => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: PurchasingRFQ;
    suppliers: PurchasingRFQSupplier[];
  }>(path.to.purchasingRfq(rfqId));

  const newSupplierModal = useDisclosure();
  const [created, setCreated] = useState<string>("");

  const [allSuppliers] = useSuppliers();
  const supplierOptions = useMemo(() => {
    return (
      allSuppliers.map((c) => ({
        value: c.id,
        label: c.name
      })) ?? []
    );
  }, [allSuppliers]);

  // Get current supplier IDs from the RFQ
  const currentSupplierIds = useMemo(() => {
    return (
      (routeData?.suppliers
        ?.map((s) => s.supplierId)
        .filter(Boolean) as string[]) ?? []
    );
  }, [routeData?.suppliers]);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: keyof PurchasingRFQ, value: string | null) => {
      if (value === routeData?.rfqSummary[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", rfqId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.purchasingRfqDetails(rfqId)
      });
    },

    [rfqId, routeData?.rfqSummary]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", rfqId);
      formData.append("table", "purchasingRfq");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [rfqId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateSuppliers = useCallback(
    (supplierIds: string[]) => {
      const formData = new FormData();

      formData.append("purchasingRfqId", rfqId);
      supplierIds.forEach((id) => formData.append("supplierIds", id));

      fetcher.submit(formData, {
        method: "post",
        action: path.to.purchasingRfqSuppliers(rfqId)
      });
    },

    [rfqId]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: rfqId,
    table: "purchasingRfq"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.rfqSummary?.assignee;
  const permissions = usePermissions();

  const isDisabled =
    !permissions.can("update", "purchasing") ||
    !isRfqEditable(routeData?.rfqSummary?.status);

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin +
                        path.to.purchasingRfqDetails(rfqId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to RFQ</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(routeData?.rfqSummary?.rfqId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy RFQ number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.rfqSummary?.rfqId}</span>
      </VStack>

      <Assignee
        id={rfqId}
        table="purchasingRfq"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "purchasing")}
      />

      <ValidatedForm
        defaultValues={{
          supplierIds: currentSupplierIds
        }}
        validator={z.object({
          supplierIds: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <CreatableMultiSelect
          name="supplierIds"
          label="Suppliers"
          options={supplierOptions}
          value={currentSupplierIds}
          inline={SuppliersInlinePreview}
          isReadOnly={isDisabled}
          disabled={isDisabled}
          onChange={(selected) => {
            onUpdateSuppliers(selected);
          }}
          onCreateOption={(option) => {
            newSupplierModal.onOpen();
            setCreated(option);
          }}
        />
        {newSupplierModal.isOpen && (
          <SupplierForm
            type="modal"
            onClose={() => {
              setCreated("");
              newSupplierModal.onClose();
            }}
            initialValues={{
              name: created
            }}
          />
        )}
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          rfqDate: routeData?.rfqSummary?.rfqDate ?? ""
        }}
        validator={z.object({
          rfqDate: z.string().min(1, { message: "RFQ Date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="rfqDate"
          label="RFQ Date"
          inline
          onChange={(date) => {
            onUpdate("rfqDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          expirationDate: routeData?.rfqSummary?.expirationDate ?? ""
        }}
        validator={z.object({
          expirationDate: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <DatePicker
          name="expirationDate"
          label="Expiration Date"
          inline
          onChange={(date) => {
            onUpdate("expirationDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          locationId: routeData?.rfqSummary?.locationId ?? undefined
        }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" })
        })}
        className="w-full"
      >
        <Location
          label="RFQ Location"
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
          employeeId: routeData?.rfqSummary?.employeeId ?? undefined
        }}
        validator={z.object({
          employeeId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Employee
          name="employeeId"
          label="Buyer"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("employeeId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.rfqSummary?.customFields ?? {}) as Record<string, Json>
        }
        table="purchasingRfq"
        tags={[]}
        onUpdate={onUpdateCustomFields}
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

const SuppliersInlinePreview = (
  value: string[],
  options: { value: string; label: string; helper?: string }[],
  maxPreview = 5
) => {
  const [suppliers] = useSuppliers();
  return (
    <AvatarGroup limit={maxPreview} className="relative z-10">
      <AvatarGroupList>
        {value.map((supplier, index: number) => (
          <Avatar
            key={index}
            name={suppliers.find((s) => s.id === supplier)?.name ?? supplier}
          />
        ))}
      </AvatarGroupList>
      <AvatarOverflowIndicator />
    </AvatarGroup>
  );
};

export default PurchasingRFQProperties;
