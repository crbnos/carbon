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
  CustomFormFields,
  Hidden,
  Location,
  Number,
  ShippingMethod,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import { salesInvoiceShipmentValidator } from "~/modules/invoicing";
import type { action } from "~/routes/x+/sales-invoice+/$invoiceId.shipment";
import { path } from "~/utils/path";

type SalesInvoiceShipmentFormProps = {
  initialValues: z.infer<typeof salesInvoiceShipmentValidator>;
  currencyCode: string;
  defaultCollapsed?: boolean;
};

export type SalesInvoiceShipmentFormRef = {
  focusShippingCost: () => void;
};

const SalesInvoiceShipmentForm = forwardRef<
  SalesInvoiceShipmentFormRef,
  SalesInvoiceShipmentFormProps
>(({ initialValues, currencyCode, defaultCollapsed = true }, ref) => {
  const { invoiceId } = useParams();
  if (!invoiceId) {
    throw new Error("invoiceId not found");
  }

  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesInvoice?.status ?? ""
  );

  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();
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

  return (
    <Card
      ref={cardRef}
      isCollapsible
      defaultCollapsed={defaultCollapsed}
      isCollapsed={isCollapsed}
      onCollapsedChange={setIsCollapsed}
    >
      <ValidatedForm
        method="post"
        action={path.to.salesInvoiceShipment(invoiceId)}
        validator={salesInvoiceShipmentValidator}
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
              name="supplierShippingCost"
              label="Shipping Cost"
              minValue={0}
              formatOptions={{
                style: "currency",
                currency: currencyCode,
              }}
              ref={shippingCostRef}
            />
            <Location
              name="locationId"
              label="Shipment Location"
              isReadOnly={isCustomer}
              isClearable
            />
            <ShippingMethod name="shippingMethodId" label="Shipping Method" />
            <CustomFormFields table="salesInvoiceShipment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={!permissions.can("update", "invoicing") || !isEditable}
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

SalesInvoiceShipmentForm.displayName = "SalesInvoiceShipmentForm";

export default SalesInvoiceShipmentForm;
