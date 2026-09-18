import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DatePicker, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { bankTransactionValidator } from "../../accounting.models";

type BankTransactionFormProps = {
  companyBankAccountId: string;
  onClose: () => void;
};

/**
 * NetSuite "Method 1: Manual Match" — enter one bank line by hand (paper
 * statement, no file) alongside the CSV upload path. It writes into the same
 * bankTransaction table and gets the same auto-match pass as an import.
 */
const BankTransactionForm = ({
  companyBankAccountId,
  onClose
}: BankTransactionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={bankTransactionValidator}
            method="post"
            action={path.to.newBankTransaction(companyBankAccountId)}
            defaultValues={{ postedDate: "", amount: 0, description: "" }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Add Bank Transaction</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <DatePicker name="postedDate" label={t`Date`} />
                <Number
                  name="amount"
                  label={t`Amount`}
                  helperText={t`Positive = money in, negative = money out`}
                />
                <Input name="description" label={t`Description`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "accounting")}>
                  <Trans>Add</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default BankTransactionForm;
