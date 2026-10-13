// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Number,
  Select,
  SequenceOrCustomId,
  Submit,
  Supplier,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import {
  isMemoLocked,
  memoDirection,
  memoValidator
} from "~/modules/invoicing";

type MemoFormValues = z.infer<typeof memoValidator>;

// The one memo document is presented as two forms. `type` fixes the PARTY — and
// only the party — which is also what each list route filters on:
//   creditMemo     → customer
//   supplierCredit → supplier
// Direction stays a user choice. It briefly did not: deriving it from the party
// and force-submitting it rewrote a stored direction on every save and made two
// of the four legal combinations unauthorable. See the Select below.
export type MemoType = "creditMemo" | "supplierCredit";

type MemoFormProps = {
  initialValues: MemoFormValues & { status?: string };
  type: MemoType;
};

/**
 * The memo's own fields, laid flat. On the detail page they sit under the
 * memo's header; the new-memo page frames them itself. Posting locks them.
 */
const MemoForm = ({ initialValues, type }: MemoFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(
    company?.baseCurrencyCode ?? "USD"
  );
  const permissions = usePermissions();
  const isEditing = Boolean(initialValues.id);
  const isLocked = isMemoLocked(initialValues.status);
  const canMutate = permissions.can("update", "invoicing");

  const isVendor = type === "supplierCredit";

  // `type` decides the PARTY (and therefore which list this memo appears in and
  // which selector is shown) — never the direction. All four party×direction
  // combinations are legal: `memoDirection` has both values, `memo`'s only party
  // constraint is customer-XOR-supplier, both list routes filter on the party and
  // offer direction as a FILTER, and the dataset validator requires coverage of
  // both. Deriving `direction` from the party and force-submitting it via
  // `<Hidden value>` overwrote the stored value on any save (`Hidden` prefers
  // `value` over `defaultValue`), so editing a customer Debit memo's reference
  // silently flipped it to Credit and posting then booked the opposite journal —
  // and it made two of the four combinations unauthorable.
  const directionOptions = memoDirection.map((d) => ({
    label: <Enumerable value={d} />,
    value: d
  }));

  return (
    <ValidatedForm
      method="post"
      validator={memoValidator}
      defaultValues={initialValues}
      isDisabled={isEditing && isLocked}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        {isEditing && <Hidden name="memoId" />}
      </div>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 @xl:grid-cols-2">
        {!isEditing && (
          <SequenceOrCustomId name="memoId" label={t`Memo ID`} table="memo" />
        )}
        {isVendor ? (
          <Supplier
            autoFocus={!isEditing}
            name="supplierId"
            label={t`Supplier`}
          />
        ) : (
          <Customer
            autoFocus={!isEditing}
            name="customerId"
            label={t`Customer`}
          />
        )}
        <Select
          name="direction"
          label={t`Direction`}
          options={directionOptions}
        />
        <DatePicker name="memoDate" label={t`Memo Date`} />
        <Currency name="currencyCode" label={t`Currency`} />
        <Number
          name="exchangeRate"
          label={t`Exchange Rate`}
          step={INPUT_STEP.exchangeRate}
          formatOptions={INPUT_FORMAT.exchangeRate}
        />
        <Number
          name="amount"
          label={t`Amount`}
          formatOptions={INPUT_FORMAT.money(
            company?.baseCurrencyCode ?? "USD",
            currencyDecimals
          )}
        />
        <Input name="reference" label={t`Reference`} />
        <CustomFormFields table="memo" />
      </div>
      <TextArea name="notes" label={t`Notes`} />
      <div>
        <Submit
          isDisabled={
            isEditing
              ? isLocked || !canMutate
              : !permissions.can("create", "invoicing")
          }
        >
          <Trans>Save</Trans>
        </Submit>
      </div>
    </ValidatedForm>
  );
};

export default MemoForm;
