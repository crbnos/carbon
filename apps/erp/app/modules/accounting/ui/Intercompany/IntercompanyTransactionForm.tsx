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
import { today } from "@internationalized/date";
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
  companies: {
    id: string;
    name: string;
    baseCurrencyCode: string | null;
    timezone: string | null;
  }[];
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
                <SourcePostingDateSync companies={companies} />
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

// The journal posts to the SOURCE company's books, so the default posting date
// is that company's calendar day — which can differ from the acting company's
// (and the browser's) around midnight. Only overwrites while the user hasn't
// picked a source yet or switches it; an explicit date edit stays theirs until
// the next source change.
function SourcePostingDateSync({
  companies
}: {
  companies: { id: string; timezone: string | null }[];
}) {
  const [sourceCompanyId] = useControlField<string>("sourceCompanyId");
  const [, setPostingDate] = useControlField<string>("postingDate");

  const timezone =
    companies.find((c) => c.id === sourceCompanyId)?.timezone ?? null;

  // Keyed on sourceCompanyId (not just timezone) so switching between two
  // companies in the SAME zone still re-defaults a manually edited date.
  useEffect(() => {
    if (timezone) setPostingDate(today(timezone).toString());
    // biome-ignore lint/correctness/useExhaustiveDependencies: sourceCompanyId intentionally re-triggers the default
  }, [sourceCompanyId, timezone, setPostingDate]);

  return null;
}

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
