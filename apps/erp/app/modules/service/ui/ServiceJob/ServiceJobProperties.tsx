// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker, Select, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Copy,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { isServiceJobLocked } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, EmployeeAvatar, Hyperlink } from "~/components";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  Item,
  Location
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import MaintenancePriority from "~/modules/resources/ui/Maintenance/MaintenancePriority";
import type { action as coverageAction } from "~/routes/x+/service-job+/$jobId.coverage";
import type { action as updateAction } from "~/routes/x+/service-job+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { ServiceCoverage, ServiceJobPriority } from "../../service.models";
import {
  serviceBillingMethods,
  serviceCoverages,
  serviceJobPriorities,
  serviceWorkSites
} from "../../service.models";
import type { ServiceJobDetail } from "../../types";
import { WarrantyBadge } from "../ServiceStatus";
import CoverageBadge from "./CoverageBadge";
import ServiceJobStatus from "./ServiceJobStatus";
import {
  useBillingMethodLabels,
  useEstimateStatusLabels,
  useWorkSiteLabels
} from "./useServiceJobLabels";

const ServiceJobProperties = () => {
  const { t } = useLingui();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const permissions = usePermissions();
  const workSiteLabels = useWorkSiteLabels();
  const billingMethodLabels = useBillingMethodLabels();

  const routeData = useRouteData<{ job: ServiceJobDetail }>(
    path.to.serviceJob(jobId)
  );
  const job = routeData?.job;

  const fetcher = useAction<typeof updateAction>({});
  // A coverage change posts a reclass journal, so it has its own route.
  const coverageFetcher = useAction<typeof coverageAction>({
    onSuccess: () => toast.success(t`Coverage changed`)
  });
  const estimateStatusLabels = useEstimateStatusLabels();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onCoverageChange = useCallback(
    (coverage: string) => {
      const formData = new FormData();
      formData.append("coverage", coverage);
      coverageFetcher.submit(formData, {
        method: "post",
        action: path.to.serviceJobCoverage(jobId)
      });
    },
    [jobId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdate = useCallback(
    (field: string, value: string | null) => {
      const formData = new FormData();
      formData.append("ids", jobId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.serviceJobUpdate
      });
    },
    [jobId]
  );

  const isLocked = isServiceJobLocked(job?.status);
  const isDisabled = isLocked || !permissions.can("update", "service");

  const asset = job?.customerAsset;
  const returnOrder = job?.salesReturnOrderLine?.salesReturnOrder;

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
                      window.location.origin + path.to.serviceJob(jobId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to job</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
            <Copy
              text={job?.id ?? ""}
              label={t`Copy job unique identifier`}
              icon={<LuKeySquare className="size-3" />}
              variant="ghost"
              className="w-auto"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(job?.serviceJobId ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy job number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{job?.serviceJobId}</span>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Status</Trans>
        </h3>
        <ServiceJobStatus status={job?.status} />
      </VStack>

      <Assignee
        id={jobId}
        table="serviceJob"
        value={job?.assignee ?? ""}
        variant="inline"
        isReadOnly={isDisabled}
        onAssign={(value) => onUpdate("assignee", value || null)}
      />

      <ValidatedForm
        defaultValues={{ customerId: job?.customerId ?? "" }}
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
            if (value?.value) onUpdate("customerId", value.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerLocationId: job?.customerLocationId ?? ""
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerLocation
          name="customerLocationId"
          label={t`Customer Location`}
          customer={job?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerLocation) => {
            onUpdate("customerLocationId", customerLocation?.id ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerContactId: job?.customerContactId ?? ""
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          label={t`Contact`}
          customer={job?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerContact) => {
            onUpdate("customerContactId", customerContact?.id ?? null);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Asset</Trans>
        </h3>
        {asset ? (
          <HStack className="w-full min-w-0">
            <Hyperlink to={path.to.customerAsset(asset.id)}>
              <span className="whitespace-nowrap">
                {asset.trackedEntity?.readableId}
              </span>
            </Hyperlink>
            <span className="shrink-0">
              <WarrantyBadge asset={asset} />
            </span>
          </HStack>
        ) : (
          <span className="text-muted-foreground">
            <Trans>No asset</Trans>
          </span>
        )}
        {job?.item && (
          <span className="text-xs text-muted-foreground truncate w-full">
            {[job.item.readableIdWithRevision, job.item.name]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </VStack>

      <ValidatedForm
        defaultValues={{ coverage: job?.coverage ?? "" }}
        validator={z.object({ coverage: z.string().optional() })}
        className="w-full"
      >
        <Select
          name="coverage"
          label={t`Coverage`}
          options={serviceCoverages.map((value) => ({
            value,
            label: <CoverageBadge coverage={value} />
          }))}
          isReadOnly={isDisabled || coverageFetcher.state !== "idle"}
          inline={(value) => (
            <CoverageBadge coverage={value as ServiceCoverage} />
          )}
          onChange={(value) => {
            if (value && value.value !== job?.coverage) {
              onCoverageChange(value.value);
            }
          }}
        />
      </ValidatedForm>

      {job?.estimateStatus && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">
            <Trans>Estimate</Trans>
          </h3>
          <span>
            {estimateStatusLabels[job.estimateStatus]}
            {job.estimateRespondedBy ? ` · ${job.estimateRespondedBy}` : ""}
          </span>
        </VStack>
      )}

      <ValidatedForm
        defaultValues={{ billingMethod: job?.billingMethod ?? "" }}
        validator={z.object({ billingMethod: z.string().optional() })}
        className="w-full"
      >
        <Select
          name="billingMethod"
          label={t`Billing Method`}
          options={serviceBillingMethods.map((value) => ({
            value,
            label: billingMethodLabels[value]
          }))}
          isReadOnly={isDisabled}
          inline={(value) => (
            <span>
              {billingMethodLabels[value as keyof typeof billingMethodLabels] ??
                value}
            </span>
          )}
          onChange={(value) => {
            if (value) onUpdate("billingMethod", value.value);
          }}
        />
      </ValidatedForm>

      {job?.billingMethod === "Fixed Price" && (
        <ValidatedForm
          defaultValues={{ serviceItemId: job?.serviceItemId ?? "" }}
          validator={z.object({
            serviceItemId: zfd.text(z.string().optional())
          })}
          className="w-full"
        >
          <Item
            name="serviceItemId"
            label={t`Billed Item`}
            type="Service"
            inline
            isClearable
            isReadOnly={isDisabled}
            onChange={(value) => {
              onUpdate("serviceItemId", value?.value ?? null);
            }}
          />
        </ValidatedForm>
      )}

      <ValidatedForm
        defaultValues={{ workSite: job?.workSite ?? "" }}
        validator={z.object({ workSite: z.string().optional() })}
        className="w-full"
      >
        <Select
          name="workSite"
          label={t`Work Site`}
          options={serviceWorkSites.map((value) => ({
            value,
            label: workSiteLabels[value]
          }))}
          isReadOnly={isDisabled}
          inline={(value) => (
            <span>
              {workSiteLabels[value as keyof typeof workSiteLabels] ?? value}
            </span>
          )}
          onChange={(value) => {
            if (value) onUpdate("workSite", value.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: job?.locationId ?? "" }}
        validator={z.object({ locationId: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <Location
          name="locationId"
          label={t`Location`}
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) onUpdate("locationId", value.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ priority: job?.priority ?? "" }}
        validator={z.object({ priority: z.string().optional() })}
        className="w-full"
      >
        <Select
          name="priority"
          label={t`Priority`}
          options={serviceJobPriorities.map((priority) => ({
            value: priority,
            label: <MaintenancePriority priority={priority} />
          }))}
          isReadOnly={isDisabled}
          inline={(value) => (
            <MaintenancePriority priority={value as ServiceJobPriority} />
          )}
          onChange={(value) => {
            if (value) onUpdate("priority", value.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ dueDate: job?.dueDate ?? "" }}
        validator={z.object({ dueDate: z.string().optional() })}
        className="w-full"
      >
        <DatePicker
          name="dueDate"
          label={t`Due Date`}
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("dueDate", date);
          }}
        />
      </ValidatedForm>

      {returnOrder && (
        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">
            <Trans>RMA</Trans>
          </h3>
          <Hyperlink to={path.to.salesReturnOrder(returnOrder.id)}>
            <span className="whitespace-nowrap">
              {returnOrder.salesReturnOrderId}
            </span>
          </Hyperlink>
        </VStack>
      )}

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Created By</Trans>
        </h3>
        <EmployeeAvatar employeeId={job?.createdBy ?? null} size="xxs" />
      </VStack>
    </VStack>
  );
};

export default ServiceJobProperties;
