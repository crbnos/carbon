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
import type { z } from "zod";
import {
  Account,
  Boolean,
  Currency,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { companyBankAccountValidator } from "../../accounting.models";

type CompanyBankAccountFormProps = {
  initialValues: z.infer<typeof companyBankAccountValidator>;
  type?: "modal" | "drawer";
  onClose: () => void;
};

const CompanyBankAccountForm = ({
  initialValues,
  type = "drawer",
  onClose
}: CompanyBankAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={companyBankAccountValidator}
            method="post"
            action={
              isEditing
                ? path.to.bankAccount(initialValues.id!)
                : path.to.newBankAccount
            }
            defaultValues={initialValues}
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
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Account
                  name="glAccountId"
                  label={t`GL Account`}
                  classes={["Asset"]}
                />
                <Currency name="currencyCode" label={t`Currency`} />
                <Boolean name="active" label={t`Active`} />
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

export default CompanyBankAccountForm;
