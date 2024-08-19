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

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Employees,
  Hidden,
  Input,
  Number,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { abilityValidator } from "../../resources.models";

type AbilityFormProps = {
  initialValues: z.infer<typeof abilityValidator>;
};

const AbilityForm = ({ initialValues }: AbilityFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const [maxShadowWeeks, setMaxShadowWeeks] = useState(initialValues.weeks);
  // const [equipmentRequired, setEquipmentRequired] = useState(initialValues.equipmentType !== undefined);

  const onWeekChange = (value: number) => {
    setMaxShadowWeeks(value);
  };

  const isDisabled = !permissions.can("create", "resources");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={abilityValidator}
          method="post"
          action={path.to.newAbility}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>New Ability</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Name" />
              {/* <Boolean
                name="machineOperator"
                label="Equipment Required"
                description="This ability requires specific equipment"

              /> */}
              <Select
                name="startingPoint"
                label="Learning Curve"
                options={[
                  { value: "85", label: "Easy" },
                  { value: "70", label: "Medium" },
                  { value: "50", label: "Hard" },
                ]}
              />
              <Number
                name="weeks"
                label="Time to Efficiency (Weeks)"
                onChange={onWeekChange}
                minValue={0}
                maxValue={52}
              />
              <Number
                name="shadowWeeks"
                label="Time Shadowing (Weeks)"
                helperText="Non-productive time spent shadowing another employee"
                minValue={0}
                maxValue={maxShadowWeeks}
              />
              <Employees
                name="employees"
                selectionsMaxHeight={"calc(100vh - 330px)"}
                label="Employees"
                helperText="Employees who already have this ability"
              />
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

export default AbilityForm;
