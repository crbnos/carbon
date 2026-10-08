// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  isWarehouseTransferLocked,
  warehouseTransferValidator
} from "../../inventory.models";
import type { WarehouseTransfer } from "../../types";

type WarehouseTransferFormProps = {
  initialValues: z.infer<typeof warehouseTransferValidator>;
  warehouseTransfer?: WarehouseTransfer;
};

/**
 * The transfer's own fields, laid flat — under its header on the transfer
 * page, inside a card on the new-transfer page. Only a Draft is editable.
 */
const WarehouseTransferForm = ({
  initialValues,
  warehouseTransfer
}: WarehouseTransferFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const isEditing = !!initialValues.id;
  const isLocked = isWarehouseTransferLocked(warehouseTransfer?.status);
  const canEdit = isEditing
    ? permissions.can("update", "inventory") &&
      ["Draft"].includes(warehouseTransfer?.status ?? "")
    : permissions.can("create", "inventory");

  return (
    <ValidatedForm
      validator={warehouseTransferValidator}
      method="post"
      defaultValues={initialValues}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
      isDisabled={isEditing && isLocked}
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        {isEditing && <Hidden name="transferId" />}
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-x-8 gap-y-4 w-full items-start">
        {!isEditing && (
          <SequenceOrCustomId
            name="transferId"
            label={t`Transfer ID`}
            table="warehouseTransfer"
          />
        )}
        <Input name="reference" label={t`Reference`} autoFocus={!isEditing} />
        <Location name="fromLocationId" label={t`From Location`} />
        <Location name="toLocationId" label={t`To Location`} />
        {isEditing && (
          <>
            <DatePicker name="transferDate" label={t`Transfer Date`} />
            <DatePicker
              name="expectedReceiptDate"
              label={t`Expected Receipt Date`}
              termId="warehouse-transfer-expected-receipt-date"
            />
          </>
        )}
      </div>
      <TextArea name="notes" label={t`Notes`} />
      <div>
        <Submit disabled={!canEdit}>
          <Trans>Save</Trans>
        </Submit>
      </div>
    </ValidatedForm>
  );
};

export default WarehouseTransferForm;
