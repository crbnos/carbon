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
import { Hidden, Item, Submit, WarrantyTerm } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerWarrantyTermValidator } from "../../sales.models";

type CustomerWarrantyTermFormProps = {
  initialValues: z.infer<typeof customerWarrantyTermValidator>;
  onClose: () => void;
};

const CustomerWarrantyTermForm = ({
  initialValues,
  onClose
}: CustomerWarrantyTermFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={customerWarrantyTermValidator}
            method="post"
            action={path.to.customerWarrantyTermNew(initialValues.customerId)}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Warranty Rule</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="customerId" />
              <VStack spacing={4}>
                <Item
                  name="itemId"
                  label={t`Item`}
                  type="Item"
                  helperText={t`Leave empty to cover every item this customer buys`}
                />
                <WarrantyTerm name="warrantyTermId" label={t`Warranty Term`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "sales")}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
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

export default CustomerWarrantyTermForm;
