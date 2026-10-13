// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  Combobox,
  CustomFormFields,
  DefaultDisabledSubmit,
  Hidden,
  Input,
  Location,
  Select,
  ShippingMethod
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ShipmentSourceDocument,
  shipmentStatusType
} from "~/modules/inventory";
// From the models file, not the module barrel: the barrel re-exports this
// form, and the cycle left `ShipmentForm` read before it was defined in dev.
import {
  shipmentSourceDocumentType,
  shipmentValidator
} from "~/modules/inventory/inventory.models";
import { path } from "~/utils/path";
import useShipmentForm from "./useShipmentForm";

type ShipmentFormProps = {
  initialValues: z.infer<typeof shipmentValidator>;
  status: (typeof shipmentStatusType)[number];
};

const formId = "shipment-form";

/**
 * The shipment's own fields, laid flat under its header. Posting locks where
 * it ships from and what it ships; tracking stays editable.
 */
const ShipmentForm = ({ initialValues, status }: ShipmentFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const {
    locationId,
    sourceDocument,
    sourceDocuments,
    customerId,
    setLocationId,
    setSourceDocument
  } = useShipmentForm({ status, initialValues });

  const isPosted = status === "Posted";
  const isRental = initialValues.sourceDocument === "Rental Agreement";
  const isEditing = initialValues.id !== undefined;

  return (
    <ValidatedForm
      id={formId}
      validator={shipmentValidator}
      method="post"
      action={path.to.shipmentDetails(initialValues.id)}
      defaultValues={initialValues}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        <Hidden name="shipmentId" />
        <Hidden name="customerId" value={customerId ?? ""} />
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-x-8 gap-y-4 w-full">
        <Select
          name="sourceDocument"
          label={t`Source Document`}
          termId="shipment-source-document"
          options={shipmentSourceDocumentType
            .filter((v) => isRental || v !== "Rental Agreement")
            .map((v) => ({
              label: v,
              value: v
            }))}
          onChange={(newValue) => {
            if (newValue) {
              setSourceDocument(newValue.value as ShipmentSourceDocument);
            }
          }}
          isReadOnly={isPosted || isRental}
        />
        <Combobox
          key={sourceDocument}
          name="sourceDocumentId"
          label={t`Source Document ID`}
          termId="shipment-source-document-id"
          options={sourceDocuments.map((d) => ({
            label: d.name,
            value: d.id
          }))}
          isReadOnly={isPosted || isRental}
        />
        <Location
          name="locationId"
          label={t`Location`}
          value={locationId ?? undefined}
          onChange={(newValue) => {
            if (newValue) setLocationId(newValue.value as string);
          }}
          isReadOnly={isPosted}
        />
        <ShippingMethod name="shippingMethodId" label={t`Shipping Method`} />
        <Input name="trackingNumber" label={t`Tracking Number`} />
        <CustomFormFields table="shipment" />
      </div>
      <div>
        <DefaultDisabledSubmit
          formId={formId}
          isDisabled={
            isEditing
              ? !permissions.can("update", "inventory")
              : !permissions.can("create", "inventory")
          }
        >
          <Trans>Save</Trans>
        </DefaultDisabledSubmit>
      </div>
    </ValidatedForm>
  );
};

export default ShipmentForm;
