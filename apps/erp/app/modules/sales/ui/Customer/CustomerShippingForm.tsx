import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  Hidden,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { customerShippingValidator } from "../../sales.models";

type CustomerShippingFormProps = {
  initialValues: z.infer<typeof customerShippingValidator>;
};

const CustomerShippingForm = ({ initialValues }: CustomerShippingFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.shippingCustomerId
  );

  // const shippingTermOptions =
  //   routeData?.shippingTerms?.map((term) => ({
  //     value: term.id,
  //     label: term.name,
  //   })) ?? [];

  const isDisabled = !permissions.can("update", "sales");

  return (
    <ValidatedForm
      method="post"
      validator={customerShippingValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Shipping</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="customerId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="shippingCustomerId"
              label={t`Shipping Customer`}
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="shippingCustomerLocationId"
              label={t`Shipping Location`}
              customer={customer}
            />
            <CustomerContact
              name="shippingCustomerContactId"
              label={t`Shipping Contact`}
              customer={customer}
            />

            <ShippingMethod
              name="shippingMethodId"
              label={t`Shipping Method`}
            />
            {/* <Select
              name="shippingTermId"
              label="Shipping Term"
              options={shippingTermOptions}
            /> */}
            <CustomFormFields table="customerShipping" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default CustomerShippingForm;
