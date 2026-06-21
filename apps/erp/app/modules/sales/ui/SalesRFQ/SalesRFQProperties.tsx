import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, useOptimisticAssignment } from "~/components";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  Employee,
  Location
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isSalesRfqLocked } from "../../sales.models";
import type { SalesRFQ } from "../../types";

const SalesRFQProperties = () => {
  const { t } = useLingui();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(path.to.salesRfq(rfqId));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: keyof SalesRFQ, value: string | null) => {
      if (value === routeData?.rfqSummary[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", rfqId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateSalesRfq
      });
    },

    [rfqId, routeData?.rfqSummary]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", rfqId);
      formData.append("table", "salesRfq");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [rfqId]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: rfqId,
    table: "salesRfq"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.rfqSummary?.assignee;
  const permissions = usePermissions();

  const canUpdate = permissions.can("update", "sales");
  const isLocked = isSalesRfqLocked(routeData?.rfqSummary?.status);
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
                      window.location.origin + path.to.salesRfqDetails(rfqId)
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
                  aria-label={t`Copy`}
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
        table="salesRfq"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />

      <ValidatedForm
        defaultValues={{ customerId: routeData?.rfqSummary?.customerId }}
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
            routeData?.rfqSummary?.customerReference ?? undefined
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label={t`Customer RFQ`}
          value={routeData?.rfqSummary?.customerReference ?? ""}
          size="sm"
          inline
          isReadOnly={isDisabled}
          onBlur={(e) => {
            onUpdate("customerReference", e.target.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerLocationId: routeData?.rfqSummary?.customerLocationId ?? ""
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerLocation
          name="customerLocationId"
          customer={routeData?.rfqSummary?.customerId ?? ""}
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
          customerContactId: routeData?.rfqSummary?.customerContactId ?? ""
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          customer={routeData?.rfqSummary?.customerId ?? ""}
          inline
          label={t`Purchasing Contact`}
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
          customerEngineeringContactId:
            routeData?.rfqSummary?.customerEngineeringContactId ?? ""
        }}
        validator={z.object({
          customerEngineeringContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerEngineeringContactId"
          customer={routeData?.rfqSummary?.customerId ?? ""}
          inline
          label={t`Engineering Contact`}
          isReadOnly={isDisabled}
          onChange={(customerEngineeringContact) => {
            if (customerEngineeringContact?.id) {
              onUpdate(
                "customerEngineeringContactId",
                customerEngineeringContact.id
              );
            }
          }}
        />
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
          label={t`RFQ Date`}
          helperText={t`The date you received this RFQ from the customer. Defaults to today.`}
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
          helperText={t`The deadline to send your quote to the customer.`}
          label={t`Due Date`}
          inline
          onChange={(date) => {
            onUpdate("expirationDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.rfqSummary?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" })
        })}
        className="w-full"
      >
        <Location
          label={t`RFQ Location`}
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
        defaultValues={{ salesPersonId: routeData?.rfqSummary?.salesPersonId }}
        validator={z.object({
          salesPersonId: z
            .string()
            .min(1, { message: "Sales person is required" })
        })}
        className="w-full"
      >
        <Employee
          name="salesPersonId"
          label={t`Sales Person`}
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("salesPersonId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.rfqSummary?.customFields ?? {}) as Record<string, Json>
        }
        table="salesRfq"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default SalesRFQProperties;
