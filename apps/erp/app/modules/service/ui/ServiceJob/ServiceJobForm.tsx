// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SelectControlled, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { suggestCoverage } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Combobox,
  Customer,
  CustomerContact,
  CustomerLocation,
  DatePicker,
  Employee,
  Hidden,
  Location,
  Select,
  Submit
} from "~/components/Form";
import { useCompanyToday, useImageUpload, usePermissions } from "~/hooks";
import MaintenancePriority from "~/modules/resources/ui/Maintenance/MaintenancePriority";
import { path } from "~/utils/path";
import type { ServiceCoverage } from "../../service.models";
import {
  serviceBillingMethods,
  serviceCoverages,
  serviceJobPriorities,
  serviceJobValidator,
  serviceWorkSites
} from "../../service.models";
import type { getCustomerAssetsList } from "../../service.service";
import { WarrantyBadge } from "../ServiceStatus";
import { useCoverageLabels } from "./CoverageBadge";
import {
  useBillingMethodLabels,
  useWorkSiteLabels
} from "./useServiceJobLabels";

type CustomerAssetOption = NonNullable<
  Awaited<ReturnType<typeof getCustomerAssetsList>>["data"]
>[number];

type ServiceJobFormProps = {
  initialValues: Partial<z.input<typeof serviceJobValidator>>;
  assets: CustomerAssetOption[];
};

/**
 * Opens a service job from the office: the customer, the unit when it is one
 * of their assets, where the work is done and how it bills. An asset suggests
 * the coverage from its warranty; the user can change it.
 */
const ServiceJobForm = ({ initialValues, assets }: ServiceJobFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const coverageLabels = useCoverageLabels();
  const workSiteLabels = useWorkSiteLabels();
  const billingMethodLabels = useBillingMethodLabels();

  const [customerId, setCustomerId] = useState(initialValues.customerId ?? "");
  const [assetId, setAssetId] = useState(initialValues.customerAssetId ?? "");
  const asset = assets.find((a) => a.id === assetId) ?? null;
  const [coverage, setCoverage] = useState<ServiceCoverage>(
    asset ? suggestCoverage(asset, today) : "Billable"
  );

  const customerAssets = assets.filter((a) => a.customerId === customerId);

  const [problem, setProblem] = useState<JSONContent>(
    initialValues.problem
      ? (JSON.parse(initialValues.problem) as JSONContent)
      : {}
  );
  const onUploadImage = useImageUpload("service-job");

  return (
    <Card>
      <ValidatedForm
        validator={serviceJobValidator}
        method="post"
        action={path.to.newServiceJob}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>New Service Job</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Repair or service a customer's unit, at the depot or on site
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
              <Customer
                name="customerId"
                label={t`Customer`}
                onChange={(value) => {
                  setCustomerId(value?.value ?? "");
                  setAssetId("");
                }}
              />
              <div className="flex w-full flex-col gap-1.5 min-w-0">
                <Combobox
                  name="customerAssetId"
                  label={t`Customer Asset`}
                  isOptional
                  isReadOnly={!customerId}
                  value={assetId}
                  placeholder={
                    customerId ? t`Search by serial` : t`Choose a customer`
                  }
                  options={customerAssets.map((a) => ({
                    value: a.id,
                    label: a.trackedEntity?.readableId ?? a.id,
                    helper: [a.item?.readableIdWithRevision, a.item?.name]
                      .filter(Boolean)
                      .join(" · ")
                  }))}
                  onChange={(value) => {
                    const next = assets.find((a) => a.id === value?.value);
                    setAssetId(next?.id ?? "");
                    setCoverage(
                      next ? suggestCoverage(next, today) : "Billable"
                    );
                  }}
                />
                {asset && (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                    <span className="truncate">
                      {[asset.item?.readableIdWithRevision, asset.item?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="shrink-0">
                      <WarrantyBadge asset={asset} />
                    </span>
                  </span>
                )}
              </div>
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customerId}
                isOptional
              />
              <CustomerContact
                name="customerContactId"
                label={t`Contact`}
                customer={customerId}
                isOptional
              />
              <div className="md:col-span-2 flex flex-col gap-2 w-full">
                <Hidden name="problem" value={JSON.stringify(problem)} />
                <Label>
                  <Trans>Problem</Trans>
                </Label>
                <Editor
                  initialValue={problem}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setProblem(value);
                  }}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] py-3 px-4 border rounded-md w-full"
                />
              </div>
              <SelectControlled
                name="coverage"
                label={t`Coverage`}
                value={coverage}
                options={serviceCoverages.map((value) => ({
                  value,
                  label: coverageLabels[value]
                }))}
                helperText={
                  asset
                    ? t`Suggested from the asset's warranty: ${coverageLabels[suggestCoverage(asset, today)]}`
                    : undefined
                }
                onChange={(value) => {
                  if (value) setCoverage(value.value as ServiceCoverage);
                }}
              />
              <Select
                name="billingMethod"
                label={t`Billing Method`}
                options={serviceBillingMethods.map((value) => ({
                  value,
                  label: billingMethodLabels[value]
                }))}
              />
              <Select
                name="workSite"
                label={t`Work Site`}
                options={serviceWorkSites.map((value) => ({
                  value,
                  label: workSiteLabels[value]
                }))}
              />
              <Location name="locationId" label={t`Location`} />
              <Select
                name="priority"
                label={t`Priority`}
                options={serviceJobPriorities.map((priority) => ({
                  value: priority,
                  label: <MaintenancePriority priority={priority} />
                }))}
              />
              <Employee name="assignee" label={t`Assignee`} isOptional />
              <DatePicker name="dueDate" label={t`Due Date`} />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("create", "service")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ServiceJobForm;
