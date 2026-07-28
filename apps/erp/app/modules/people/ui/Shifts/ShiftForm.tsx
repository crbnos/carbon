import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormLabel,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Submit,
  TimePicker
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { shiftValidator } from "../../people.models";

type ShiftFormProps = {
  initialValues: z.infer<typeof shiftValidator>;
};

const ShiftForm = ({ initialValues }: ShiftFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "people")
    : !permissions.can("create", "people");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={shiftValidator}
          method="post"
          action={
            isEditing ? path.to.shift(initialValues.id!) : path.to.newShift
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? <Trans>Edit Shift</Trans> : <Trans>New Shift</Trans>}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Shift Name`} />
              <Location name="locationId" label={t`Location`} />
              <TimePicker name="startTime" label={t`Start Time`} />
              <TimePicker name="endTime" label={t`End Time`} />

              <FormControl>
                <FormLabel>
                  <Trans>Days</Trans>
                </FormLabel>
                <VStack>
                  <Boolean name="monday" description={t`Monday`} bordered />
                  <Boolean name="tuesday" description={t`Tuesday`} bordered />
                  <Boolean
                    name="wednesday"
                    description={t`Wednesday`}
                    bordered
                  />
                  <Boolean name="thursday" description={t`Thursday`} bordered />
                  <Boolean name="friday" description={t`Friday`} bordered />
                  <Boolean name="saturday" description={t`Saturday`} bordered />
                  <Boolean name="sunday" description={t`Sunday`} bordered />
                </VStack>
              </FormControl>
              <CustomFormFields table="shift" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ShiftForm;
