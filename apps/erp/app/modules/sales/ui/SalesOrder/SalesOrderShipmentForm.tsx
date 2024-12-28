import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
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
  Number,
  ShippingMethod,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/sales-order+/$orderId.shipment";
import { path } from "~/utils/path";
import { salesOrderShipmentValidator } from "../../sales.models";
import type { SalesOrder } from "../../types";

type SalesOrderShipmentFormProps = {
  initialValues: z.infer<typeof salesOrderShipmentValidator>;
  // shippingTerms: ListItem[];
};

const SalesOrderShipmentForm = ({
  initialValues,
}: // shippingTerms,
SalesOrderShipmentFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();
  const [dropShip, setDropShip] = useState<boolean>(
    initialValues.dropShipment ?? false
  );
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );

  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  const routeData = useRouteData<{
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const { company } = useUser();

  const isCustomer = permissions.is("customer");

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        action={path.to.salesOrderShipment(initialValues.id)}
        method="post"
        validator={salesOrderShipmentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>Shipping</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="shippingCost"
              label="Shipping Cost"
              formatOptions={{
                style: "currency",
                currency:
                  routeData?.salesOrder?.currencyCode ??
                  company?.baseCurrencyCode,
              }}
            />
            <Location
              name="locationId"
              label="Shipment Location"
              isReadOnly={isCustomer}
              isClearable
            />
            <ShippingMethod name="shippingMethodId" label="Shipping Method" />
            {/* <Select
              name="shippingTermId"
              label="Shipping Terms"
              isReadOnly={isCustomer}
              options={shippingTermOptions}
            /> */}

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
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderShipmentForm;
