import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheckCheck, LuTicketX, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DocumentHeader } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  Account,
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
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import {
  isPaymentLocked,
  paymentType,
  paymentValidator
} from "~/modules/invoicing";
import { path } from "~/utils/path";
import PaymentStatus from "./PaymentStatus";

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

type PaymentFormProps = {
  initialValues: PaymentFormValues & { status?: string };
  // When set, a hidden field carries the seed invoice ids through to the
  // action, which auto-creates a starter application against each (re-fetching
  // their open balances server-side). Drives the workbench "pay N invoices"
  // hand-off as well as the single-invoice "Pay Invoice" link.
  seedInvoiceIds?: string[];
};

const PaymentForm = ({ initialValues, seedInvoiceIds }: PaymentFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const permissions = usePermissions();
  const post = useFetcher();
  const voidFetcher = useFetcher();
  const isEditing = Boolean(initialValues.id);
  const status = initialValues.status as
    | "Draft"
    | "Posted"
    | "Voided"
    | undefined;
  const isLocked = isPaymentLocked(initialValues.status);
  const canMutate = permissions.can("update", "invoicing");
  const canDelete = permissions.can("delete", "invoicing");
  const deleteModal = useDisclosure();

  // The counterparty selector visibility tracks paymentType so users
  // see Customer for Receipts and Supplier for Disbursements.
  const [currentType, setCurrentType] = useState<"Receipt" | "Disbursement">(
    initialValues.paymentType ?? "Receipt"
  );

  const typeOptions = paymentType.map((t) => ({
    label: t === "Receipt" ? "Payment from Customer" : "Payment to Supplier",
    value: t
  }));

  return (
    <>
      <ValidatedForm
        method="post"
        validator={paymentValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
        className="w-full"
      >
        <Card>
          {isEditing ? (
            <DocumentHeader
              title={initialValues.paymentId ?? ""}
              status={
                <>
                  <Enumerable value={initialValues.paymentType} />
                  <PaymentStatus status={status} />
                </>
              }
              menuItems={
                status === "Draft" && canDelete ? (
                  <DropdownMenuItem destructive onClick={deleteModal.onOpen}>
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete</Trans>
                  </DropdownMenuItem>
                ) : undefined
              }
              actions={
                status === "Draft" ? (
                  <Button
                    leftIcon={<LuCheckCheck />}
                    variant="primary"
                    isLoading={post.state !== "idle"}
                    isDisabled={!canMutate}
                    onClick={() =>
                      post.submit(null, {
                        method: "post",
                        action: path.to.paymentPost(initialValues.id!)
                      })
                    }
                  >
                    <Trans>Post</Trans>
                  </Button>
                ) : status === "Posted" ? (
                  <Button
                    leftIcon={<LuTicketX />}
                    variant="destructive"
                    isLoading={voidFetcher.state !== "idle"}
                    isDisabled={!canMutate}
                    onClick={() =>
                      voidFetcher.submit(null, {
                        method: "post",
                        action: path.to.paymentVoid(initialValues.id!)
                      })
                    }
                  >
                    <Trans>Void</Trans>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <CardHeader>
              <CardTitle>
                <Trans>New Payment</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Record cash received from a customer (Receipt) or paid to a
                  supplier (Disbursement). Applications to specific invoices are
                  added after the payment is created.
                </Trans>
              </CardDescription>
            </CardHeader>
          )}
          <CardContent>
            <Hidden name="id" />
            {isEditing && <Hidden name="paymentId" />}
            {seedInvoiceIds && seedInvoiceIds.length > 0 && (
              <Hidden name="seedInvoiceIds" value={seedInvoiceIds.join(",")} />
            )}
            <VStack>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                {!isEditing && (
                  <SequenceOrCustomId
                    name="paymentId"
                    label={t`Payment ID`}
                    table="payment"
                  />
                )}
                <Select
                  name="paymentType"
                  label={t`Type`}
                  options={typeOptions}
                  onChange={(opt) => {
                    if (
                      opt?.value === "Receipt" ||
                      opt?.value === "Disbursement"
                    ) {
                      setCurrentType(opt.value);
                    }
                  }}
                />
                {currentType === "Receipt" ? (
                  <Customer name="customerId" label={t`Customer`} />
                ) : (
                  <Supplier name="supplierId" label={t`Supplier`} />
                )}
                <DatePicker name="paymentDate" label={t`Payment Date`} />
                <Currency name="currencyCode" label={t`Currency`} />
                <Number
                  name="exchangeRate"
                  label={t`Exchange Rate`}
                  formatOptions={{
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4
                  }}
                />
                <Number
                  name="totalAmount"
                  label={t`Total Amount`}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <Account
                  name="bankAccount"
                  label={t`Bank / Cash Account`}
                  classes={["Asset"]}
                />
                <Input name="reference" label={t`Reference`} />
                <CustomFormFields table="payment" />
              </div>
              <div className="mt-4 w-full">
                <TextArea name="memo" label={t`Memo`} />
              </div>
            </VStack>
          </CardContent>
          <CardFooter>
            <Submit
              isDisabled={
                isEditing
                  ? isLocked || !canMutate
                  : !permissions.can("create", "invoicing")
              }
            >
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.paymentDelete(initialValues.id!)}
          isOpen={deleteModal.isOpen}
          name={initialValues.paymentId ?? ""}
          text={t`Are you sure you want to delete ${initialValues.paymentId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default PaymentForm;
