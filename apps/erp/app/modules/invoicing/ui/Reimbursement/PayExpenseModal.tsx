import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Account, DatePicker, Number, Submit } from "~/components/Form";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter
} from "~/hooks";
import { reimbursementPaymentValidator } from "~/modules/invoicing";
import { path } from "~/utils/path";

type PayExpenseModalProps = {
  /** The reimbursement being paid out. */
  id: string;
  /** Its readable `REIMB-…` id, for the dialog copy. */
  displayId: string;
  /** Document currency — the amount below is in it, not in company base. */
  currencyCode: string;
  /** What is still owed, in document currency. Seeds the amount field. */
  balanceDue: number;
  /** The company's default bank/cash account, so the field opens pre-filled. */
  defaultBankAccount: string;
  open: boolean;
  onClose: () => void;
};

/**
 * Pay out a Posted, not-fully-paid reimbursement. Three fields and no more —
 * amount, date, account — because they are a 1:1 match for Rillet's
 * `POST /reimbursements/{id}/payments` (`{amount, date, account_code}`), which
 * is what lets the payout cross to the provider with no impedance. A fourth
 * field would break that mapping.
 *
 * The amount DEFAULTS to the full balance but stays editable: a partial payout
 * is supported and settles part of the reimbursement, leaving the rest open.
 *
 * `$reimbursementId.pay.tsx` turns the submission into a `payment` plus one
 * `invoiceSettlement` and posts it; there is no bespoke payout path.
 */
const PayExpenseModal = ({
  id,
  displayId,
  currencyCode,
  balanceDue,
  defaultBankAccount,
  open,
  onClose
}: PayExpenseModalProps) => {
  const { t } = useLingui();
  const today = useCompanyToday().toString();
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.reimbursementPay(id)}
          validator={reimbursementPaymentValidator}
          defaultValues={{
            amount: balanceDue,
            paymentDate: today,
            bankAccount: defaultBankAccount
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Pay expense</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Record the payout of {displayId} to the employee. Pay less than
                the total due to settle it partially.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="flex w-full items-baseline justify-between text-sm">
                <span className="text-muted-foreground">
                  <Trans>Total Due</Trans>
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  {currencyFormatter.format(balanceDue)}
                </span>
              </div>
              <Number
                name="amount"
                label={t`Amount`}
                minValue={0}
                maxValue={balanceDue}
                step={INPUT_STEP.money(currencyDecimals)}
                formatOptions={INPUT_FORMAT.money(
                  currencyCode,
                  currencyDecimals
                )}
              />
              <DatePicker name="paymentDate" label={t`Date`} />
              <Account
                name="bankAccount"
                label={t`Account`}
                classes={["Asset"]}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Pay</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default PayExpenseModal;
