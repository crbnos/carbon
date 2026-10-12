// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox, Select, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import { Copy, HStack, Subheading, toast, VStack } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuKeySquare } from "react-icons/lu";
import { useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Assignee,
  CustomerAvatar,
  DateTime,
  EmployeeAvatar,
  Hyperlink,
  useOptimisticAssignment
} from "~/components";
import {
  Boolean,
  CustomerContact,
  CustomerLocation,
  NumberControlled
} from "~/components/Form";
import {
  useCurrencyDecimals,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { projectElementPriorities } from "~/modules/projects/projects.models";
import { path } from "~/utils/path";
import type { ServiceInvoiceDetail } from "../../service.models";
import { serviceInvoiceDetails } from "../../service.models";
import type { ServiceOrder } from "../../types";

export type ServiceOrderContractOption = {
  id: string;
  customerContractId: string;
  name: string;
};

const optionalText = z.object({ value: zfd.text(z.string().optional()) });

/**
 * The order's facts, each saved as it changes. The unit decides the
 * customer. Site, contact and coverage contract change only while the order
 * is Draft; the rest change until it is closed or cancelled. A Refurbishment
 * has no customer: it shows its serial, the expected selling price that caps
 * the serial's cost and whether the work is abnormal rework, both editable
 * until it completes.
 */
const ServiceOrderProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);

  const routeData = useRouteData<{
    serviceOrder: ServiceOrder;
    contracts: ServiceOrderContractOption[];
  }>(path.to.serviceOrder(id));
  const order = routeData?.serviceOrder;

  const permissions = usePermissions();
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onError: (data) => {
      if (data?.error) toast.error(data.error.message);
    }
  });

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "serviceOrder"
  });
  const assignee =
    optimisticAssignment !== undefined ? optimisticAssignment : order?.assignee;

  if (!order) return null;

  const canUpdate = permissions.can("update", "service");
  const isFinal = order.status === "Closed" || order.status === "Cancelled";
  const isDisabled = !canUpdate || isFinal;
  const isDraftOnlyDisabled = isDisabled || order.status !== "Draft";
  const isRefurbishment = order.type === "Refurbishment";
  // A completed refurbishment's cost is already in the serial.
  const isCompletionDisabled = isDisabled || order.status === "Completed";

  const onUpdate = (field: string, value: string | null) => {
    if (value === ((order as Record<string, unknown>)[field] ?? null)) return;
    fetcher.submit(
      { intent: "update", field, value: value ?? "" },
      { method: "post", action: path.to.serviceOrderDetails(id) }
    );
  };

  const priorityLabels: Record<
    (typeof projectElementPriorities)[number],
    string
  > = {
    Urgent: t`Urgent`,
    High: t`High`,
    Medium: t`Medium`,
    Low: t`Low`,
    None: t`None`
  };
  const invoiceDetailLabels: Record<ServiceInvoiceDetail, string> = {
    Itemized: t`Itemized`,
    "By Node": t`By Element`
  };

  const contracts = routeData?.contracts ?? [];
  // The order's own contract stays in the list after it ends.
  const contractOptions = [
    ...(order.customerContract &&
    !contracts.some((c) => c.id === order.customerContract!.id)
      ? [
          {
            value: order.customerContract.id,
            label: order.customerContract.customerContractId
          }
        ]
      : []),
    ...contracts.map((contract) => ({
      value: contract.id,
      label: contract.customerContractId,
      helper: contract.name
    }))
  ];

  return (
    <VStack
      spacing={4}
      className="w-96 bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <Subheading variant="light" as="h3">
            <Trans>Properties</Trans>
          </Subheading>
          <Copy
            text={id}
            label={t`Copy service order unique identifier`}
            icon={<LuKeySquare className="size-3" />}
            variant="ghost"
            className="w-auto"
          />
        </HStack>
        <span className="text-sm">{order.serviceOrderId}</span>
      </VStack>

      {isRefurbishment ? (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Serial</Trans>
          </span>
          <span className="whitespace-nowrap">
            {order.trackedEntity?.readableId ?? "—"}
          </span>
        </VStack>
      ) : (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Customer</Trans>
          </span>
          <CustomerAvatar customerId={order.customerId} />
        </VStack>
      )}

      {order.customerAssetId && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Unit</Trans>
          </span>
          <Hyperlink to={path.to.customerAsset(order.customerAssetId)}>
            {order.trackedEntity?.readableId}
          </Hyperlink>
        </VStack>
      )}

      <Assignee
        id={id}
        table="serviceOrder"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={isDisabled}
      />

      {isRefurbishment ? (
        <>
          <ValidatedForm
            defaultValues={{
              expectedSellingPrice: order.expectedSellingPrice ?? undefined
            }}
            validator={z.object({
              expectedSellingPrice: zfd.numeric(z.number().min(0).optional())
            })}
            className="w-full"
          >
            <NumberControlled
              name="expectedSellingPrice"
              label={t`Expected Selling Price`}
              inline
              isReadOnly={isCompletionDisabled}
              value={order.expectedSellingPrice ?? Number.NaN}
              minValue={0}
              formatOptions={INPUT_FORMAT.rate(
                company.baseCurrencyCode,
                currencyDecimals
              )}
              step={INPUT_STEP.rate}
              onChange={(value) =>
                onUpdate(
                  "expectedSellingPrice",
                  Number.isNaN(value) ? null : String(value)
                )
              }
            />
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{ abnormalRework: order.abnormalRework }}
            validator={z.object({ abnormalRework: zfd.checkbox() })}
            className="w-full"
            isReadOnly={isCompletionDisabled}
          >
            <Boolean
              name="abnormalRework"
              label={t`Abnormal Rework`}
              variant="small"
              isDisabled={isCompletionDisabled}
              onChange={(value) =>
                onUpdate("abnormalRework", value ? "true" : "false")
              }
            />
          </ValidatedForm>
        </>
      ) : (
        <>
          <ValidatedForm
            defaultValues={{
              customerLocationId: order.customerLocationId ?? ""
            }}
            validator={z.object({
              customerLocationId: zfd.text(z.string().optional())
            })}
            className="w-full"
          >
            <CustomerLocation
              name="customerLocationId"
              label={t`Site`}
              customer={order.customerId ?? ""}
              inline
              isReadOnly={isDraftOnlyDisabled}
              onChange={(location) => {
                if (location?.id) onUpdate("customerLocationId", location.id);
              }}
            />
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{ customerContactId: order.customerContactId ?? "" }}
            validator={z.object({
              customerContactId: zfd.text(z.string().optional())
            })}
            className="w-full"
          >
            <CustomerContact
              name="customerContactId"
              label={t`Contact`}
              customer={order.customerId ?? ""}
              inline
              isReadOnly={isDraftOnlyDisabled}
              onChange={(contact) => {
                if (contact?.id) onUpdate("customerContactId", contact.id);
              }}
            />
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{ value: order.customerContractId ?? "" }}
            validator={optionalText}
            className="w-full"
          >
            <Combobox
              name="value"
              label={t`Coverage Contract`}
              options={contractOptions}
              isOptional
              isReadOnly={isDisabled}
              inline={(value, options) => (
                <span>
                  {options.find((option) => option.value === value)?.label ??
                    "—"}
                </span>
              )}
              onChange={(value) =>
                onUpdate("customerContractId", value?.value ?? null)
              }
            />
          </ValidatedForm>
        </>
      )}

      <ValidatedForm
        defaultValues={{ value: order.priority }}
        validator={optionalText}
        className="w-full"
      >
        <Select
          name="value"
          label={t`Priority`}
          options={projectElementPriorities.map((priority) => ({
            value: priority,
            label: priorityLabels[priority]
          }))}
          isReadOnly={isDisabled}
          inline={(value) => (
            <span>
              {priorityLabels[value as keyof typeof priorityLabels] ?? value}
            </span>
          )}
          onChange={(value) => {
            if (value?.value) onUpdate("priority", value.value);
          }}
        />
      </ValidatedForm>

      {!isRefurbishment && (
        <ValidatedForm
          defaultValues={{ value: order.invoiceDetail }}
          validator={optionalText}
          className="w-full"
        >
          <Select
            name="value"
            label={t`Invoice Detail`}
            options={serviceInvoiceDetails.map((detail) => ({
              value: detail,
              label: invoiceDetailLabels[detail]
            }))}
            isReadOnly={isDisabled}
            inline={(value) => (
              <span>
                {invoiceDetailLabels[value as ServiceInvoiceDetail] ?? value}
              </span>
            )}
            onChange={(value) => {
              if (value?.value) onUpdate("invoiceDetail", value.value);
            }}
          />
        </ValidatedForm>
      )}

      <VStack spacing={2}>
        <span className="text-xs text-muted-foreground">
          <Trans>Service Location</Trans>
        </span>
        <span>{order.location?.name ?? "—"}</span>
      </VStack>

      <VStack spacing={2}>
        <span className="text-xs text-muted-foreground">
          <Trans>Opened</Trans>
        </span>
        <DateTime value={order.createdAt} variant="absolute" />
      </VStack>

      {order.completedAt && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">
            <Trans>Completed</Trans>
          </span>
          <DateTime value={order.completedAt} variant="absolute" />
        </VStack>
      )}

      <VStack spacing={2}>
        <span className="text-xs text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar employeeId={order.createdBy} />
      </VStack>
    </VStack>
  );
};

export default ServiceOrderProperties;
