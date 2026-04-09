import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Location,
  Number,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import { salesInvoiceShipmentValidator } from "~/modules/invoicing";
import type { action } from "~/routes/x+/sales-invoice+/$invoiceId.shipment";
import { path } from "~/utils/path";
import { isSalesInvoiceLocked } from "../../invoicing.models";

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
>(({ initialValues, currencyCode, defaultCollapsed = false }, ref) => {
  const { t } = useLingui();
  const { invoiceId } = useParams();
  if (!invoiceId) {
    throw new Error("invoiceId not found");
  }

  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  const isLocked = isSalesInvoiceLocked(routeData?.salesInvoice?.status);
  const isEditable = !isLocked;

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
    }
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
        isDisabled={isLocked}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Shipping</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="shippingCost"
              label={t`Shipping Cost`}
              minValue={0}
              formatOptions={{
                style: "currency",
                currency: currencyCode
              }}
              ref={shippingCostRef}
            />
            <Location
              name="locationId"
              label={t`Shipment Location`}
              isReadOnly={isCustomer}
              isClearable
            />
            <ShippingMethod
              name="shippingMethodId"
              label={t`Shipping Method`}
            />
            <CustomFormFields table="salesInvoiceShipment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={!permissions.can("update", "invoicing") || !isEditable}
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

SalesInvoiceShipmentForm.displayName = "SalesInvoiceShipmentForm";

export default SalesInvoiceShipmentForm;
