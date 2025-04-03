import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
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
  defaultCollapsed?: boolean;
};

export type QuoteShipmentFormRef = {
  focusShippingCost: () => void;
};

const QuoteShipmentForm = forwardRef<
  QuoteShipmentFormRef,
  QuoteShipmentFormProps
>(({ initialValues, defaultCollapsed = true }, ref) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const shippingCostRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusShippingCost: () => {
      setIsCollapsed(false);
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        shippingCostRef.current?.focus();
      }, 100);
    },
  }));

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
    <Card
      ref={cardRef}
      isCollapsible
      defaultCollapsed={defaultCollapsed}
      isCollapsed={isCollapsed}
      onCollapsedChange={setIsCollapsed}
    >
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
              minValue={0}
              ref={shippingCostRef}
            />
            <Location
              name="locationId"
              label="Shipment Location"
              isReadOnly={isCustomer}
              isClearable
            />
            <ShippingMethod name="shippingMethodId" label="Shipping Method" />

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
});

QuoteShipmentForm.displayName = "QuoteShipmentForm";

export default QuoteShipmentForm;
