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
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Submit,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
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

  const { company } = useUser();

  const isBaseCurrency = company?.baseCurrencyCode === initialValues.code;
  const exchangeRateHelperText = isBaseCurrency
    ? "This is the base currency. Exchange rate is always 1."
    : `One ${initialValues.code} is equal to how many ${company?.baseCurrencyCode}?`;

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
              <Input name="name" label="Name" isReadOnly />
              <Input name="code" label="Code" isReadOnly />
              <Input name="symbol" label="Symbol" isReadOnly />
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
                helperText={exchangeRateHelperText}
              />

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
