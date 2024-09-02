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
import { exchangeRatesFormValidator } from "~/modules/settings";
import { path } from "~/utils/path";

type ExchangeRatesFormProps = {
  initialValues: z.infer<typeof exchangeRatesFormValidator>;
  onClose: () => void;
};

const ExchangeRatesForm = ({
  initialValues,
  onClose,
}: ExchangeRatesFormProps) => {
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
          validator={exchangeRatesFormValidator}
          method="post"
          action={path.to.integration("exchange-rates-v1")}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>Update Exchange Rates</DrawerTitle>
            <DrawerDescription>
              Updates the exchange rates using
              http://api.exchangeratesapi.io/v1/
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

export default ExchangeRatesForm;
