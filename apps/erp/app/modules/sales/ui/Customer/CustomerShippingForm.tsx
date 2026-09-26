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
  Boolean,
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { incoterms } from "~/modules/shared";
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
  const [incoterm, setIncoterm] = useState<string | undefined>(
    initialValues.incoterm || undefined
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
              termId="shipping-customer"
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
            <Select
              name="incoterm"
              label={t`Incoterm`}
              termId="customer-incoterm"
              isClearable
              options={incoterms.map((i) => ({ value: i, label: i }))}
              onChange={(v) => setIncoterm(v?.value as string)}
            />
            {incoterm && (
              <Input name="incotermLocation" label={t`Incoterm Location`} />
            )}
            {/* <Select
              name="shippingTermId"
              label="Shipping Term"
              options={shippingTermOptions}
            /> */}
            <CustomFormFields table="customerShipping" />
          </div>
          <div className="flex flex-col gap-4 w-full mt-8">
            <h3 className="text-sm font-medium text-foreground">
              <Trans>Certifications</Trans>
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Boolean
                name="requiresCertificateOfConformance"
                label={t`Requires Certificate of Conformance`}
                description={t`Posting a shipment to this customer issues a certificate and emails it to the shipping contact.`}
                bordered
              />
              <Boolean
                name="requiresFirstArticle"
                label={t`Requires First Article`}
                description={t`Releasing a job for this customer creates first article inspections for parts that need one.`}
                bordered
              />
            </div>
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
