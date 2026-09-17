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
import type { AccountLabelKey, BankCodeLabelKey } from "@carbon/utils";
import { getBankFieldConfig } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import Country from "~/components/Form/Country";
import { usePermissions } from "~/hooks";
import { supplierBankAccountValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierBankAccountFormProps = {
  initialValues: z.infer<typeof supplierBankAccountValidator>;
  type?: "drawer" | "modal";
  open?: boolean;
  onClose: () => void;
};

const SupplierBankAccountForm = ({
  initialValues,
  type = "drawer",
  open = true,
  onClose
}: SupplierBankAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const navigate = useNavigate();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  // The country decides what the two identifier fields are called and how they
  // validate, so it is tracked in state rather than read once from initialValues.
  const [countryCode, setCountryCode] = useState(
    initialValues.countryCode ?? ""
  );
  const bankFields = getBankFieldConfig(countryCode);

  const ACCOUNT_LABELS: Record<AccountLabelKey, string> = {
    accountNumber: t`Account Number`,
    iban: t`IBAN`
  };
  const BANK_CODE_LABELS: Record<BankCodeLabelKey, string> = {
    aba: t`Routing Number (ABA)`,
    sortCode: t`Sort Code`,
    bsb: t`BSB`,
    ifsc: t`IFSC Code`,
    transit: t`Transit & Institution`,
    bankCode: t`Bank Code`
  };

  const accountLabel = ACCOUNT_LABELS[bankFields.accountLabel];
  const bankCodeLabel = bankFields.bankCodeLabel
    ? BANK_CODE_LABELS[bankFields.bankCodeLabel]
    : null;

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            if (type === "modal") {
              onClose?.();
            } else {
              navigate(-1);
            }
          }
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={supplierBankAccountValidator}
            method="post"
            action={
              isEditing
                ? path.to.supplierBankAccount(supplierId, initialValues.id!)
                : path.to.newSupplierBankAccount(supplierId)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Bank Account</Trans>
                ) : (
                  <Trans>New Bank Account</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <Hidden name="supplierId" value={supplierId} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} isRequired />
                <Input
                  name="accountHolderName"
                  label={t`Account Holder`}
                  helperText={t`Only if it differs from the supplier name`}
                />
                <Input name="bankName" label={t`Bank Name`} isRequired />
                {/* Correspondent banks route international wires on this. */}
                <TextArea
                  name="bankAddress"
                  label={t`Bank Address`}
                  isRequired
                />
                <Country
                  name="countryCode"
                  label={t`Country`}
                  isRequired
                  onChange={(value) => setCountryCode(value?.value ?? "")}
                />
                <Currency name="currencyCode" label={t`Currency`} />
                <Input name="accountNumber" label={accountLabel} isRequired />
                {bankCodeLabel && (
                  <Input name="bankCode" label={bankCodeLabel} isRequired />
                )}
                <Input
                  name="swiftBic"
                  label={t`SWIFT / BIC`}
                  isRequired={bankFields.requiresSwift}
                />
                <TextArea name="notes" label={t`Notes`} />
                <CustomFormFields table="supplierBankAccount" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
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

export default SupplierBankAccountForm;
