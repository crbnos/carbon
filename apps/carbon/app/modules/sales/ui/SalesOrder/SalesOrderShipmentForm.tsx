import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Customer,
  CustomerLocation,
  DatePicker,
  Hidden,
  Input,
  Location,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { salesOrderShipmentValidator } from "~/modules/sales";
import type { ListItem } from "~/types";

type SalesOrderShipmentFormProps = {
  initialValues: z.infer<typeof salesOrderShipmentValidator>;
  shippingMethods: ListItem[];
  shippingTerms: ListItem[];
};

const SalesOrderShipmentForm = ({
  initialValues,
  shippingMethods,
  shippingTerms,
}: SalesOrderShipmentFormProps) => {
  const permissions = usePermissions();
  const [dropShip, setDropShip] = useState<boolean>(
    initialValues.dropShipment ?? false
  );
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );

  const shippingMethodOptions = shippingMethods.map((method) => ({
    label: method.name,
    value: method.id,
  }));

  const shippingTermOptions = shippingTerms.map((term) => ({
    label: term.name,
    value: term.id,
  }));

  const isCustomer = permissions.is("customer");

  return (
    <ValidatedForm
      method="post"
      validator={salesOrderShipmentValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Shipment</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Location
              name="locationId"
              label="Shipment Location"
              isReadOnly={isCustomer}
              isClearable
            />
            <Select
              name="shippingMethodId"
              label="Shipping Method"
              options={shippingMethodOptions}
            />
            <Select
              name="shippingTermId"
              label="Shipping Terms"
              isReadOnly={isCustomer}
              options={shippingTermOptions}
            />

            <DatePicker name="receiptRequestedDate" label="Requested Date" />
            <DatePicker name="receiptPromisedDate" label="Promised Date" />
            <DatePicker name="shipmentDate" label="Shipment Date" />

            <Input name="trackingNumber" label="Tracking Number" />
            {/* <TextArea name="notes" label="Shipping Notes" /> */}
            <Boolean
              name="dropShipment"
              label="Drop Shipment"
              onChange={setDropShip}
            />
            {dropShip && (
              <>
                <Customer
                  name="customerId"
                  label="Customer"
                  onChange={(value) => setCustomer(value?.value as string)}
                />
                <CustomerLocation
                  name="customerLocationId"
                  label="Location"
                  customer={customer}
                />
              </>
            )}
            <CustomFormFields table="salesOrderShipment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "sales")}>Save</Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default SalesOrderShipmentForm;
