import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Location,
  Number,
  ShippingMethod,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { quoteShipmentValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type QuoteShipmentFormProps = {
  initialValues: z.infer<typeof quoteShipmentValidator>;
  // shippingTerms: ListItem[];
};

const QuoteShipmentForm = ({
  initialValues,
}: // shippingTerms,
QuoteShipmentFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  // const shippingTermOptions = shippingTerms.map((term) => ({
  //   label: term.name,
  //   value: term.id,
  // }));

  const isCustomer = permissions.is("customer");

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.quote?.status ?? ""
  );

  const { company } = useUser();

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        action={path.to.quoteShipment(initialValues.id)}
        method="post"
        validator={quoteShipmentValidator}
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
                currency: company?.baseCurrencyCode,
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
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={!permissions.can("update", "sales") || !isEditable}
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteShipmentForm;
