// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DefaultDisabledSubmit, ValidatedForm } from "@carbon/form";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Select
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ReceiptSourceDocument,
  receiptStatusType
} from "~/modules/inventory";
import {
  receiptSourceDocumentType,
  receiptValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";
import useReceiptForm from "./useReceiptForm";

type ReceiptFormProps = {
  initialValues: z.infer<typeof receiptValidator>;
  status: (typeof receiptStatusType)[number];
};

const formId = "receipt-form";

/**
 * The receipt's own fields, laid flat under its header. Posting locks where
 * it was received and what it receives.
 */
const ReceiptForm = ({ initialValues, status }: ReceiptFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const {
    locationId,
    sourceDocuments,
    supplierId,
    setLocationId,
    setSourceDocument
  } = useReceiptForm({ status, initialValues });

  const isPosted = status === "Posted";
  const isRental = initialValues.sourceDocument === "Rental Agreement";
  const isEditing = initialValues.id !== undefined;

  return (
    <ValidatedForm
      id={formId}
      validator={receiptValidator}
      method="post"
      action={path.to.receiptDetails(initialValues.id)}
      defaultValues={initialValues}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        <Hidden name="receiptId" />
        <Hidden name="supplierId" value={supplierId ?? ""} />
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-x-8 gap-y-4 w-full">
        <Select
          name="sourceDocument"
          label={t`Source Document`}
          termId="receipt-source-document"
          options={receiptSourceDocumentType
            .filter((v) => isRental || v !== "Rental Agreement")
            .map((v) => ({
              label: v,
              value: v
            }))}
          onChange={(newValue) => {
            if (newValue) {
              setSourceDocument(newValue.value as ReceiptSourceDocument);
            }
          }}
          isReadOnly={isPosted || isRental}
        />
        <Combobox
          name="sourceDocumentId"
          label={t`Source Document ID`}
          termId="receipt-source-document-id"
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
        <Input
          name="externalDocumentId"
          label={t`External Reference`}
          termId="receipt-external-reference"
          isDisabled={isPosted}
        />
        <CustomFormFields table="receipt" />
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

export default ReceiptForm;
