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
              <ModalDrawerTitle>New IC Transaction</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="type" value="drawer" />
              <VStack spacing={4}>
                <Select
                  name="sourceCompanyId"
                  label="Source Company"
                  options={companyOptions}
                />
                <Select
                  name="targetCompanyId"
                  label="Target Company"
                  options={companyOptions}
                />
                <Number name="amount" label="Amount" minValue={0} />
                <SourceCurrencySync companies={companies} />
                <Input name="description" label="Description" />
                <Account name="debitAccountId" label="Debit Account" />
                <Account name="creditAccountId" label="Credit Account" />
                <Input
                  name="postingDate"
                  label="Posting Date"
                  termId="posting"
                  type="date"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
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
