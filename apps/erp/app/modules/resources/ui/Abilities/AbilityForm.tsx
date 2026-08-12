import { Input, Number, Submit, ValidatedForm } from "@carbon/form";
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
import { usePermissions } from "~/hooks";
import { abilityValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type AbilityFormProps = {
  initialValues: z.infer<typeof abilityValidator> & {
    id?: string;
  };
  open?: boolean;
  onClose: () => void;
};

const AbilityForm = ({
  initialValues,
  open = true,
  onClose
}: AbilityFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={abilityValidator}
            method="post"
            action={
              isEditing
                ? path.to.abilityDetails(initialValues.id!)
                : path.to.newAbility
            }
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Ability</Trans>
                ) : (
                  <Trans>New Ability</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Number
                  name="recertifyEveryDays"
                  label={t`Recertify Every (Days)`}
                  helperText={t`Qualification expires this many days after training; blank = never`}
                  minValue={1}
                />
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

export default AbilityForm;
