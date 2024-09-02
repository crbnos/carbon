import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
} from "@carbon/react";
import type { z } from "zod";
import { Boolean, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { resendFormValidator } from "~/modules/settings";
import { path } from "~/utils/path";

type GooglePlacesFormProps = {
  initialValues: z.infer<typeof resendFormValidator>;
  onClose: () => void;
};

const GooglePlacesForm = ({
  initialValues,
  onClose,
}: GooglePlacesFormProps) => {
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "settings");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={resendFormValidator}
          method="post"
          action={path.to.integration("google-places-v2")}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>Google Places</DrawerTitle>
            <DrawerDescription>
              Autocomplete addresses with Google Places API
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Boolean name="active" label="Active" />
              <Input name="apiKey" label="API Key" />
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

export default GooglePlacesForm;
