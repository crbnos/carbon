// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import type { z } from "zod";
import {
  Combobox,
  CustomerContact,
  Hidden,
  Item,
  Location,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { projectElementPriorities } from "~/modules/projects/projects.models";
import { SerialSelect } from "~/modules/projects/ui/Element/SerialSelect";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import type {
  ServiceOrderStartFrom,
  serviceOrderTypes
} from "../../service.models";
import { serviceOrderValidator } from "../../service.models";
import type { getServiceOrderFormOptions } from "../../service.service";
import { WarrantyBadge } from "../ServiceStatus";

type FormOptions = Omit<
  Awaited<ReturnType<typeof getServiceOrderFormOptions>>,
  "error"
>;

type ServiceOrderFormProps = {
  initialValues: Partial<z.input<typeof serviceOrderValidator>>;
  options: FormOptions;
};

type NewServiceOrderType = (typeof serviceOrderTypes)[number];

/**
 * Opens a service order. A Field Visit is for a unit at a customer: the unit
 * decides the customer, the site and the item, and the coverage contract is
 * proposed when the customer has exactly one Active contract. A
 * Refurbishment is for a serial the company holds in stock: it has no
 * customer, and the serial goes On Hold until the order completes. The work
 * tree starts empty, from a service template, from the unit's build history
 * or from the item's bill of materials.
 */
export default function ServiceOrderForm({
  initialValues,
  options
}: ServiceOrderFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();

  const [type, setType] = useState<NewServiceOrderType>(
    initialValues.type ?? "Field Visit"
  );
  const isRefurbishment = type === "Refurbishment";
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Part");
  const [itemId, setItemId] = useState(initialValues.itemId ?? "");
  // The serial belongs to the item: a new item clears it.
  const [serial, setSerial] = useState<{
    itemId: string;
    trackedEntityId: string;
  } | null>(null);
  const trackedEntityId =
    serial && serial.itemId === itemId ? serial.trackedEntityId : "";

  const [assetId, setAssetId] = useState(initialValues.customerAssetId ?? "");
  const asset = options.assets.find((a) => a.id === assetId) ?? null;
  const customerContracts = useMemo(
    () =>
      asset
        ? options.contracts.filter(
            (contract) => contract.customerId === asset.customerId
          )
        : [],
    [asset, options.contracts]
  );
  // The user's own pick wins; with none, the customer's only Active contract
  // is proposed, as `createServiceOrder` would choose it.
  const [chosenContract, setChosenContract] = useState<{
    assetId: string;
    contractId: string;
  } | null>(null);
  const contractId =
    chosenContract && chosenContract.assetId === assetId
      ? chosenContract.contractId
      : customerContracts.length === 1
        ? customerContracts[0]!.id
        : "";

  const [startFrom, setStartFrom] = useState<ServiceOrderStartFrom>(
    initialValues.startFrom ?? "Empty"
  );

  const typeOptions: { value: NewServiceOrderType; label: string }[] = [
    { value: "Field Visit", label: t`Field Visit` },
    { value: "Refurbishment", label: t`Refurbishment` }
  ];

  const startFromOptions: { value: ServiceOrderStartFrom; label: string }[] = [
    { value: "Empty", label: t`Empty` },
    { value: "Template", label: t`Service template` },
    { value: "Serial", label: t`The unit's build history` },
    { value: "Item", label: t`The item's bill of materials` }
  ];

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

  return (
    <Card>
      <ValidatedForm
        validator={serviceOrderValidator}
        method="post"
        action={path.to.newServiceOrder}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>New Service Order</Trans>
          </CardTitle>
          <CardDescription>
            {isRefurbishment ? (
              <Trans>
                The refurbishment of a serial in stock. The serial is on hold
                until the order completes, and the work's cost moves into the
                serial's cost.
              </Trans>
            ) : (
              <Trans>
                A field visit to a unit at a customer. The unit decides the
                customer and the site.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
            <Select
              name="type"
              label={t`Type`}
              options={typeOptions}
              onChange={(value) =>
                setType(
                  (value?.value as NewServiceOrderType | undefined) ??
                    "Field Visit"
                )
              }
            />
            <Location name="locationId" label={t`Service Location`} />
            {isRefurbishment ? (
              <>
                <Item
                  name="itemId"
                  label={t`Item`}
                  type={itemType}
                  onTypeChange={setItemType}
                  value={itemId}
                  onChange={(value) => setItemId(value?.value ?? "")}
                />
                <div className="flex w-full flex-col gap-1.5 min-w-0">
                  <span className="text-sm font-medium">
                    <Trans>Serial</Trans>
                  </span>
                  {itemId ? (
                    <SerialSelect
                      itemId={itemId}
                      value={trackedEntityId || null}
                      isReadOnly={false}
                      onChange={(next) =>
                        setSerial(
                          next ? { itemId, trackedEntityId: next } : null
                        )
                      }
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      <Trans>Choose the item to see its serials.</Trans>
                    </span>
                  )}
                  <Hidden name="trackedEntityId" value={trackedEntityId} />
                </div>
              </>
            ) : (
              <>
                <Combobox
                  name="customerAssetId"
                  label={t`Unit`}
                  placeholder={t`Search by serial`}
                  options={options.assets.map((a) => ({
                    value: a.id,
                    label: a.trackedEntity?.readableId ?? a.id,
                    helper: [a.item?.readableIdWithRevision, a.customer?.name]
                      .filter(Boolean)
                      .join(" · ")
                  }))}
                  onChange={(value) => setAssetId(value?.value ?? "")}
                />
                <div className="flex flex-col gap-1 justify-end min-w-0 pb-2">
                  {asset ? (
                    <>
                      <span className="text-sm truncate">
                        {asset.customer?.name}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                        <span className="truncate">
                          {[
                            asset.item?.readableIdWithRevision,
                            asset.item?.name
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <WarrantyBadge asset={asset} />
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      <Trans>
                        Choose the unit to see its customer and warranty.
                      </Trans>
                    </span>
                  )}
                </div>
                <CustomerContact
                  name="customerContactId"
                  label={t`Contact`}
                  customer={asset?.customerId}
                  isOptional
                />
                <Combobox
                  name="customerContractId"
                  label={t`Coverage Contract`}
                  isOptional
                  value={contractId}
                  options={customerContracts.map((contract) => ({
                    value: contract.id,
                    label: contract.customerContractId,
                    helper: contract.name
                  }))}
                  emptyMessage={t`This customer has no active contract`}
                  onChange={(value) =>
                    setChosenContract({
                      assetId,
                      contractId: value?.value ?? ""
                    })
                  }
                />
              </>
            )}
            <Select
              name="priority"
              label={t`Priority`}
              options={projectElementPriorities.map((priority) => ({
                value: priority,
                label: priorityLabels[priority]
              }))}
            />
            <Select
              name="startFrom"
              label={t`Start Work From`}
              options={startFromOptions}
              onChange={(value) =>
                setStartFrom(
                  (value?.value as ServiceOrderStartFrom | undefined) ?? "Empty"
                )
              }
            />
            {startFrom === "Template" && (
              <Combobox
                name="serviceTemplateId"
                label={t`Service Template`}
                options={options.templates.map((template) => ({
                  value: template.id,
                  label: template.name
                }))}
                emptyMessage={t`No service templates yet`}
              />
            )}
            <div className="md:col-span-2">
              <TextArea name="problem" label={t`Problem`} />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("create", "service")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
