// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
  NumberControlled,
  Select,
  SequenceOrCustomId,
  Submit,
  Supplier,
  TaxCode,
  TextArea
} from "~/components/Form";
import { useTaxCodeRateOn } from "~/components/Form/RecoverableTax";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import {
  isMemoLocked,
  memoDirection,
  memoKeepsStoredTaxRate,
  memoValidator,
  resolveMemoTaxAmounts,
  type StoredMemoTax
} from "~/modules/invoicing/invoicing.models";

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
  /** `taxAmount` is the stored tax, shown until the tax codes load. */
  initialValues: MemoFormValues & { status?: string; taxAmount?: number };
  /** The saved memo's tax. While its code is unchanged the form keeps the
   *  rate it implies, as `upsertMemo` does. Absent on a new memo. */
  storedTax?: StoredMemoTax;
  type: MemoType;
};

/**
 * The memo's own fields, laid flat. On the detail page they sit under the
 * memo's header; the new-memo page frames them itself. Posting locks them.
 */
const MemoForm = ({ initialValues, storedTax, type }: MemoFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  // The memo's amounts are in its own currency, so they are entered and
  // rounded at that currency's decimals — the decimals `upsertMemo` uses.
  const [currencyCode, setCurrencyCode] = useState(
    initialValues.currencyCode || company?.baseCurrencyCode || "USD"
  );
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  // Net, code and date are the user's input; the tax and the gross are derived
  // from them during render (spec "Memo tax"), as `useTaxPair` derives its
  // base. Neither is submitted: `upsertMemo` computes the tax again with the
  // same `resolveMemoTaxAmounts` and stores amount = net + tax. A saved memo
  // whose code is unchanged keeps the rate its stored tax implies.
  const [netAmount, setNetAmount] = useState(initialValues.netAmount ?? 0);
  const [taxCodeId, setTaxCodeId] = useState(initialValues.taxCodeId ?? "");
  const [memoDate, setMemoDate] = useState(initialValues.memoDate);
  const taxCodeRateOn = useTaxCodeRateOn(memoDate);
  const keepsStoredRate =
    storedTax !== undefined && memoKeepsStoredTaxRate(storedTax, taxCodeId);
  const codeRate = taxCodeId && !keepsStoredRate ? taxCodeRateOn(taxCodeId) : 0;
  // An emptied number input commits NaN; it reads as no amount (NaN > 0 is
  // false), never as a NaN tax.
  const net = netAmount > 0 ? netAmount : 0;
  const resolved = resolveMemoTaxAmounts({
    stored: storedTax ?? null,
    netAmount: net,
    amount: undefined,
    taxCodeId: taxCodeId || null,
    codeRate: codeRate ?? 0,
    decimals: currencyDecimals
  });
  // Until the codes load the rate is unknown; show the stored tax meanwhile.
  const taxAmount =
    codeRate === null || "error" in resolved
      ? (initialValues.taxAmount ?? 0)
      : resolved.taxAmount;
  const grossAmount = round(net + taxAmount, currencyDecimals);
  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
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
        <DatePicker
          name="memoDate"
          label={t`Memo Date`}
          onChange={(date) => {
            if (date) setMemoDate(date);
          }}
        />
        <Currency
          name="currencyCode"
          label={t`Currency`}
          onChange={(option) => {
            if (option) setCurrencyCode(option.value);
          }}
        />
        <Number
          name="exchangeRate"
          label={t`Exchange Rate`}
          step={INPUT_STEP.exchangeRate}
          formatOptions={INPUT_FORMAT.exchangeRate}
        />
        <NumberControlled
          name="netAmount"
          label={t`Net Amount`}
          value={netAmount}
          onChange={setNetAmount}
          minValue={0}
          step={INPUT_STEP.money(currencyDecimals)}
          formatOptions={moneyFormat}
        />
        <TaxCode
          name="taxCodeId"
          label={t`Tax Code`}
          isOptional
          onChange={(option) => setTaxCodeId(option?.value ?? "")}
        />
        <NumberControlled
          name="taxAmount"
          label={t`Tax`}
          value={taxAmount}
          isReadOnly
          formatOptions={moneyFormat}
        />
        <NumberControlled
          name="grossAmount"
          label={t`Gross`}
          value={grossAmount}
          isReadOnly
          formatOptions={moneyFormat}
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
