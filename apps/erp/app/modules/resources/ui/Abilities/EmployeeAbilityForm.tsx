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
import { EmployeeAvatar } from "~/components";
import {
  Ability,
  DatePicker,
  Employee,
  Hidden,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { employeeAbilityCellValidator } from "~/modules/resources";

type EmployeeAbilityFormProps = {
  action: string;
  title: string;
  /**
   * Which side of the relationship is being picked:
   * - "new-employee": adding an employee to a known ability
   * - "new-ability": adding an ability to a known employee
   * - "edit": both are fixed
   */
  mode: "new-employee" | "new-ability" | "edit";
  initialValues: z.infer<typeof employeeAbilityCellValidator>;
  onClose: () => void;
};

const EmployeeAbilityForm = ({
  action,
  title,
  mode,
  initialValues,
  onClose
}: EmployeeAbilityFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isDisabled = !permissions.can("update", "resources");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={employeeAbilityCellValidator}
            method="post"
            action={action}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>{title}</ModalDrawerTitle>
              {mode === "edit" && (
                <EmployeeAvatar employeeId={initialValues.employeeId} />
              )}
            </ModalDrawerHeader>
            <ModalDrawerBody>
              {mode !== "new-employee" && <Hidden name="employeeId" />}
              {mode !== "new-ability" && <Hidden name="abilityId" />}
              <VStack spacing={4}>
                {mode === "new-employee" && (
                  <Employee name="employeeId" label={t`Employee`} />
                )}
                {mode === "new-ability" && (
                  <Ability name="abilityId" label={t`Ability`} />
                )}
                <DatePicker
                  name="lastTrainingDate"
                  label={t`Last Training Date`}
                />
                <DatePicker
                  name="expiresAt"
                  label={t`Expires At`}
                  helperText={t`Blank = computed from the ability's recertification period`}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
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

export default EmployeeAbilityForm;
