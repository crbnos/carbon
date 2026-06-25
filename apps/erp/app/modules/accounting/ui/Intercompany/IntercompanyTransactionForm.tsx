import { useControlField, ValidatedForm } from "@carbon/form";
import {
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
import { useEffect } from "react";
import type { z } from "zod";
import {
  Account,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { intercompanyTransactionValidator } from "../../accounting.models";

type IntercompanyTransactionFormProps = {
  initialValues: z.infer<typeof intercompanyTransactionValidator>;
  companies: { id: string; name: string; baseCurrencyCode: string | null }[];
  open?: boolean;
  onClose: () => void;
};

const IntercompanyTransactionForm = ({
  initialValues,
  companies,
  open = true,
  onClose
}: IntercompanyTransactionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isDisabled = !permissions.can("create", "accounting");

  const companyOptions = companies.map((c) => ({
    label: c.name,
    value: c.id
  }));

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={intercompanyTransactionValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>New IC Transaction</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="type" value="drawer" />
              <VStack spacing={4}>
                <Select
                  name="sourceCompanyId"
                  label={t`Source Company`}
                  options={companyOptions}
                />
                <Select
                  name="targetCompanyId"
                  label={t`Target Company`}
                  options={companyOptions}
                />
                <Number name="amount" label={t`Amount`} minValue={0} />
                <SourceCurrencySync companies={companies} />
                <Input name="description" label={t`Description`} />
                <Account
                  name="debitAccountId"
                  label={t`Debit Account`}
                  termId="intercompany-debit-account"
                />
                <Account
                  name="creditAccountId"
                  label={t`Credit Account`}
                  termId="intercompany-credit-account"
                />
                <Input
                  name="postingDate"
                  label={t`Posting Date`}
                  termId="intercompany-posting-date"
                  type="date"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

function SourceCurrencySync({
  companies
}: {
  companies: { id: string; baseCurrencyCode: string | null }[];
}) {
  const [sourceCompanyId] = useControlField<string>("sourceCompanyId");
  const [, setCurrencyCode] = useControlField<string>("currencyCode");

  const currencyCode =
    companies.find((c) => c.id === sourceCompanyId)?.baseCurrencyCode ?? "";

  useEffect(() => {
    setCurrencyCode(currencyCode);
  }, [currencyCode, setCurrencyCode]);

  return <Hidden name="currencyCode" value={currencyCode} />;
}

export default IntercompanyTransactionForm;
