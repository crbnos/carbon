import { Combobox, Input, Number, Submit, ValidatedForm } from "@carbon/form";
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
import { usePermissions } from "~/hooks";
import {
  abilityRecertifyValidator,
  abilityValidator
} from "~/modules/resources";
import { path } from "~/utils/path";

type AbilityFormProps = {
  initialValues: {
    id?: string;
    processId?: string;
    name?: string;
    recertifyEveryDays?: number;
  };
  // Processes that don't already have an ability — the only things a new
  // ability can be created from. Omitted when editing.
  processes?: { value: string; label: string }[];
  open?: boolean;
  onClose: () => void;
};

const AbilityForm = ({
  initialValues,
  processes = [],
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
            validator={isEditing ? abilityRecertifyValidator : abilityValidator}
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
                {isEditing ? (
                  // The process (and therefore the name) is fixed for the life
                  // of the ability — shown read-only for context.
                  <Input name="name" label={t`Ability`} isReadOnly />
                ) : (
                  <Combobox
                    name="processId"
                    label={t`Process`}
                    options={processes}
                    helperText={t`An ability is a process's qualification. Only processes without one are listed.`}
                  />
                )}
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
