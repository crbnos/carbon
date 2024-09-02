import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Location,
  ShippingMethod,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { quoteShipmentValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuoteShipmentFormProps = {
  initialValues: z.infer<typeof quoteShipmentValidator>;
  // shippingTerms: ListItem[];
};

const QuoteShipmentForm = ({
  initialValues,
}: // shippingTerms,
QuoteShipmentFormProps) => {
  const permissions = usePermissions();

  // const shippingTermOptions = shippingTerms.map((term) => ({
  //   label: term.name,
  //   value: term.id,
  // }));

  const isCustomer = permissions.is("customer");

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        action={path.to.quoteShipment(initialValues.id)}
        method="post"
        validator={quoteShipmentValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Shipping</CardTitle>
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
            <ShippingMethod name="shippingMethodId" label="Shipping Method" />
            {/* <Select
              name="shippingTermId"
              label="Shipping Terms"
              isReadOnly={isCustomer}
              options={shippingTermOptions}
            /> */}

            <DatePicker name="receiptRequestedDate" label="Requested Date" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "sales")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteShipmentForm;
