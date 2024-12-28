import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Employee,
  Hidden,
  Number,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { AbilityEmployeeStatus, type Ability } from "../../types";

import { path } from "~/utils/path";
import { employeeAbilityValidator } from "../../resources.models";

type EmployeeAbilityFormProps = {
  ability?: Ability;
  initialValues: z.infer<typeof employeeAbilityValidator>;
  weeks: number;
  onClose: () => void;
};

const defaultPercent = 0.5;

const EmployeeAbilityForm = ({
  ability,
  initialValues,
  weeks,
  onClose,
}: EmployeeAbilityFormProps) => {
  const { id } = useParams();
  const permissions = usePermissions();
  const isEditing = !!initialValues.employeeId;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const days = (percent: number) => weeks * 5 * percent;
  const [trainingDays, setTrainingDays] = useState(
    days(initialValues.trainingPercent ?? defaultPercent)
  );
  const updateTrainingDays = (percent: number) => {
    setTrainingDays(days(percent));
  };

  const [inProgress, setInProgress] = useState(
    initialValues?.trainingStatus === AbilityEmployeeStatus.InProgress
  );

  if (!ability) return null;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={employeeAbilityValidator}
          method="post"
          action={
            isEditing
              ? path.to.employeeAbility(ability.id, id!)
              : path.to.newEmployeeAbility(ability.id)
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Employee</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Employee
                name="employeeId"
                label="Employee"
                isReadOnly={isEditing}
              />
              <Select
                name="trainingStatus"
                label="Training Status"
                onChange={(value) => {
                  setInProgress(
                    value?.value === AbilityEmployeeStatus.InProgress
                  );
                }}
                options={[
                  {
                    value: AbilityEmployeeStatus.NotStarted,
                    label: "Not Started",
                  },
                  {
                    value: AbilityEmployeeStatus.InProgress,
                    label: "In Progress",
                  },
                  {
                    value: AbilityEmployeeStatus.Complete,
                    label: "Complete",
                  },
                ]}
              />
              {inProgress && (
                <>
                  <Number
                    name="trainingPercent"
                    label="Training Percent"
                    onChange={(value) => updateTrainingDays(value)}
                    defaultValue={defaultPercent}
                    formatOptions={{ style: "percent" }}
                    minValue={0}
                    maxValue={1}
                  />
                  <Hidden name="trainingDays" value={trainingDays} />
                </>
              )}
              <CustomFormFields table="employeeAbility" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default EmployeeAbilityForm;
