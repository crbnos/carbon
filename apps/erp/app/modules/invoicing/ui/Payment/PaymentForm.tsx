// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import type { z } from "zod";
import {
  Account,
  Combobox,
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Number,
  SelectControlled,
  SequenceOrCustomId,
  Submit,
  Supplier,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import {
  type DepositDocument,
  isPaymentLocked,
  paymentValidator
} from "~/modules/invoicing";
import { path } from "~/utils/path";

// Builds the "new payment" URL pre-filled from an invoice. side "ar" seeds the
// customer (→ Receipt); "ap" seeds the supplier (→ Disbursement). Lives with the
// PaymentForm (the form on the page these links open) rather than in
// invoicing.models.ts, which must stay free of the `~/utils/path` import so the
// model unit tests don't pull in the Lingui-macro glossary via @carbon/auth.
export function getPayInvoiceHref(args: {
  side: "ar" | "ap";
  partyId: string | null | undefined;
  invoiceId: string;
  balance: number | null | undefined;
}): string {
  const partyParam = args.side === "ar" ? "customerId" : "supplierId";
  return `${path.to.paymentNew}?${partyParam}=${encodeURIComponent(
    args.partyId ?? ""
  )}&invoiceId=${encodeURIComponent(
    args.invoiceId
  )}&amount=${encodeURIComponent(String(args.balance ?? 0))}`;
}

// Builds the "apply credit" URL: a $0 receipt/payment for the party, so the
// settlement composer opens with no cash and the party's posted credits ready to
// apply. No invoiceId (that would seed a cash amount from the invoice balance).
export function getApplyCreditHref(args: {
  side: "ar" | "ap";
  partyId: string | null | undefined;
}): string {
  const partyParam = args.side === "ar" ? "customerId" : "supplierId";
  return `${path.to.paymentNew}?${partyParam}=${encodeURIComponent(
    args.partyId ?? ""
  )}&amount=0`;
}

type PaymentFormValues = z.infer<typeof paymentValidator>;

// The picker's single value: the two ids travel as separate hidden fields
// (`salesOrderId` / `rentalAgreementId`, at most one set — the validator and
// `payment_deposit_document_check` both enforce it).
const depositValue = (doc: Pick<DepositDocument, "kind" | "id">) =>
  `${doc.kind}:${doc.id}`;
const parseDepositValue = (value: string) => {
  const separator = value.indexOf(":");
  if (separator < 0) return { salesOrderId: "", rentalAgreementId: "" };
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return {
    salesOrderId: kind === "salesOrder" ? id : "",
    rentalAgreementId: kind === "rentalAgreement" ? id : ""
  };
};

type PaymentFormProps = {
  initialValues: PaymentFormValues & { status?: string };
  // When set, a hidden field carries the seed invoice ids through to the
  // action, which auto-creates a starter application against each (re-fetching
  // their open balances server-side). Drives the workbench "pay N invoices"
  // hand-off as well as the single-invoice "Pay Invoice" link.
  seedInvoiceIds?: string[];
  // Documents the "Deposit for" picker offers. Omitted = no picker (the saved
  // ids still round-trip through the hidden fields).
  depositDocuments?: DepositDocument[];
};

/**
 * The payment's own fields, laid flat. On the detail page they sit under the
 * payment's header; the new-payment page frames them itself. Posting locks
 * them.
 */
const PaymentForm = ({
  initialValues,
  seedInvoiceIds,
  depositDocuments
}: PaymentFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const [currencyCode, setCurrencyCode] = useState(
    initialValues.currencyCode || company?.baseCurrencyCode || "USD"
  );
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const permissions = usePermissions();
  const isEditing = Boolean(initialValues.id);
  const isLocked = isPaymentLocked(initialValues.status);
  const canMutate = permissions.can("update", "invoicing");

  // Cash direction and subledger party are independent for refunds. An employee
  // payee is neither: it is always cash OUT against the reimbursement control
  // account, so it has a single kind rather than a payment/refund pair.
  const initialKind = initialValues.employeeId
    ? "employee-payment"
    : initialValues.supplierId
      ? initialValues.paymentType === "Receipt"
        ? "supplier-refund"
        : "supplier-payment"
      : initialValues.paymentType === "Disbursement"
        ? "customer-refund"
        : "customer-payment";
  const [paymentKind, setPaymentKind] = useState(initialKind);
  const isEmployee = paymentKind === "employee-payment";
  const isCustomer = paymentKind.startsWith("customer-");
  const currentType =
    paymentKind === "customer-payment" || paymentKind === "supplier-refund"
      ? "Receipt"
      : "Disbursement";

  // The deposit picker follows the selected customer; picking a customer clears
  // a document that belonged to the previous one.
  const [customerId, setCustomerId] = useState(initialValues.customerId ?? "");
  const initialDeposit = initialValues.rentalAgreementId
    ? depositValue({
        kind: "rentalAgreement",
        id: initialValues.rentalAgreementId
      })
    : initialValues.salesOrderId
      ? depositValue({ kind: "salesOrder", id: initialValues.salesOrderId })
      : "";
  const [deposit, setDeposit] = useState(initialDeposit);
  // UI-only controlled fields are seeded through the form defaults so the
  // registered value matches what is shown on first render.
  const defaultValues = {
    ...initialValues,
    paymentKind: initialKind,
    depositDocument: initialDeposit
  };
  const showDepositPicker = isCustomer && depositDocuments !== undefined;
  const depositOptions = useMemo(() => {
    if (!showDepositPicker) return [];
    const forReceipt = currentType === "Receipt";
    return (depositDocuments ?? [])
      .filter(
        (doc) =>
          doc.customerId === customerId &&
          (!forReceipt || doc.open || depositValue(doc) === initialDeposit)
      )
      .map((doc) => ({
        value: depositValue(doc),
        label: doc.readableId,
        helper: `${
          doc.kind === "rentalAgreement" ? t`Rental Agreement` : t`Sales Order`
        } · ${doc.status}`
      }));
  }, [
    showDepositPicker,
    depositDocuments,
    customerId,
    currentType,
    initialDeposit,
    t
  ]);
  const depositIds = parseDepositValue(showDepositPicker ? deposit : "");
  const typeOptions = [
    { label: t`Payment from Customer`, value: "customer-payment" },
    { label: t`Payment to Supplier`, value: "supplier-payment" },
    { label: t`Refund to Customer`, value: "customer-refund" },
    { label: t`Refund from Supplier`, value: "supplier-refund" },
    { label: t`Reimbursement to Employee`, value: "employee-payment" }
  ];

  return (
    <ValidatedForm
      method="post"
      validator={paymentValidator}
      defaultValues={defaultValues}
      isDisabled={isEditing && isLocked}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        <Hidden name="paymentType" value={currentType} />
        {/* Exactly one party field is mounted, and the other two are
            blanked — the validator's one-of-three refine (and the DB's
            widened payment_party_check) rejects anything else. */}
        {isEmployee ? (
          <>
            <Hidden name="customerId" value="" />
            <Hidden name="supplierId" value="" />
          </>
        ) : (
          <>
            <Hidden name={isCustomer ? "supplierId" : "customerId"} value="" />
            <Hidden name="employeeId" value="" />
          </>
        )}
        <Hidden name="salesOrderId" value={depositIds.salesOrderId} />
        <Hidden name="rentalAgreementId" value={depositIds.rentalAgreementId} />
        {isEditing && <Hidden name="paymentId" />}
        {seedInvoiceIds && seedInvoiceIds.length > 0 && (
          <Hidden name="seedInvoiceIds" value={seedInvoiceIds.join(",")} />
        )}
      </div>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 @xl:grid-cols-2">
        {!isEditing && (
          <SequenceOrCustomId
            name="paymentId"
            label={t`Payment ID`}
            table="payment"
          />
        )}
        <SelectControlled
          autoFocus={!isEditing}
          name="paymentKind"
          label={t`Type`}
          options={typeOptions}
          value={paymentKind}
          onChange={(opt) => {
            if (opt) setPaymentKind(opt.value);
          }}
        />
        {isEmployee ? (
          <Employee name="employeeId" label={t`Employee`} />
        ) : isCustomer ? (
          <Customer
            name="customerId"
            label={t`Customer`}
            onChange={(option) => {
              const next = option?.value ?? "";
              if (next !== customerId) setDeposit("");
              setCustomerId(next);
            }}
          />
        ) : (
          <Supplier name="supplierId" label={t`Supplier`} />
        )}
        {showDepositPicker && (
          <Combobox
            name="depositDocument"
            label={
              currentType === "Receipt" ? t`Deposit for` : t`Refund deposit for`
            }
            helperText={
              currentType === "Receipt"
                ? t`Unapplied cash is held as a customer prepayment for this document instead of on-account credit.`
                : t`Pays the deposit held for this document back out of customer prepayments.`
            }
            options={depositOptions}
            value={deposit}
            isOptional
            placeholder={t`No document`}
            onChange={(option) => setDeposit(option?.value ?? "")}
          />
        )}
        <DatePicker name="paymentDate" label={t`Payment Date`} />
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
        <Number
          name="totalAmount"
          label={t`Total Amount`}
          formatOptions={INPUT_FORMAT.money(currencyCode, currencyDecimals)}
        />
        <Account
          name="bankAccount"
          label={t`Bank / Cash Account`}
          classes={["Asset"]}
        />
        <Input name="reference" label={t`Reference`} />
        <CustomFormFields table="payment" />
      </div>
      <TextArea name="memo" label={t`Memo`} />
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

export default PaymentForm;
