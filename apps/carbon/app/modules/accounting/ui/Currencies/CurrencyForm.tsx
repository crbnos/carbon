import { ValidatedForm } from "@carbon/form";
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
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { Currency } from "~/modules/accounting";
import { currencyValidator } from "~/modules/accounting";
import { path } from "~/utils/path";

type CurrencyFormProps = {
  initialValues: z.infer<typeof currencyValidator>;
};

const CurrencyForm = ({ initialValues }: CurrencyFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const [decimalPlaces, setDecimalPlaces] = useState(
    initialValues.decimalPlaces ?? 2
  );

  const routeData = useRouteData<{ baseCurrency?: Currency }>(
    path.to.accountingRoot
  );
  const [name, setName] = useState(initialValues.name);

  const isBaseCurrency = routeData?.baseCurrency?.id === initialValues.id;
  const exchnageRateHelperText = isBaseCurrency
    ? "This is the base currency. Exchange rate is always 1."
    : `One ${name} is equal to how many ${routeData?.baseCurrency?.name}?`;

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={currencyValidator}
          method="post"
          action={
            isEditing
              ? path.to.currency(initialValues.id!)
              : path.to.newCurrency
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Currency</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input
                name="name"
                label="Name"
                onChange={(e) => setName(e.target.value)}
              />
              <Input name="code" label="Code" isReadOnly={isEditing} />
              <Input name="symbol" label="Symbol" />
              <Number
                name="decimalPlaces"
                label="Decimal Places"
                minValue={0}
                maxValue={4}
                onChange={setDecimalPlaces}
              />
              <Number
                name="exchangeRate"
                label="Exchange Rate"
                minValue={isBaseCurrency ? 1 : 0}
                maxValue={isBaseCurrency ? 1 : undefined}
                formatOptions={{
                  minimumFractionDigits: decimalPlaces ?? 0,
                }}
                helperText={exchnageRateHelperText}
              />
              <Boolean name="isBaseCurrency" label="Base Currency" />
              <CustomFormFields table="currency" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CurrencyForm;
