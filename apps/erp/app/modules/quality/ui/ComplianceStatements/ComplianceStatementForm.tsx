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
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  Customers,
  Hidden,
  Input,
  Items,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { complianceStatementValidator } from "../../quality.models";

type ComplianceStatementFormProps = {
  initialValues: z.infer<typeof complianceStatementValidator>;
  open?: boolean;
  onClose: () => void;
};

const ComplianceStatementForm = ({
  initialValues,
  open = true,
  onClose
}: ComplianceStatementFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={complianceStatementValidator}
            method="post"
            action={
              isEditing
                ? path.to.complianceStatement(initialValues.id!)
                : path.to.newComplianceStatement
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing
                  ? t`Edit Compliance Statement`
                  : t`New Compliance Statement`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <TextArea name="content" label={t`Content`} />
                <Boolean
                  name="appliesToAllCustomers"
                  label={t`Applies to all customers`}
                  description={t`Printed on every Certificate of Conformance`}
                />
                <Customers
                  name="customerIds"
                  label={t`Customers`}
                  placeholder={t`Select customers`}
                />
                <Items
                  name="itemIds"
                  label={t`Items`}
                  placeholder={t`Select items`}
                />
                <Boolean name="active" label={t`Active`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit hideShortcutKey isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default ComplianceStatementForm;
