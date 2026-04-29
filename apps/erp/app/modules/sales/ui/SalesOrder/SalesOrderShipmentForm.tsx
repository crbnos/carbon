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
  Boolean,
  Customer,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  Number,
  Select,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { incoterms } from "~/modules/shared";
import type { action } from "~/routes/x+/sales-order+/$orderId.shipment";
import { path } from "~/utils/path";
import {
  isSalesOrderLocked,
  salesOrderShipmentValidator
} from "../../sales.models";
import type { SalesOrder } from "../../types";

type SalesOrderShipmentFormProps = {
  initialValues: z.infer<typeof salesOrderShipmentValidator>;
  defaultCollapsed?: boolean;
};

export type SalesOrderShipmentFormRef = {
  focusShippingCost: () => void;
};

const SalesOrderShipmentForm = forwardRef<
  SalesOrderShipmentFormRef,
  SalesOrderShipmentFormProps
>(({ initialValues, defaultCollapsed = false }, ref) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();
  const [dropShip, setDropShip] = useState<boolean>(
    initialValues.dropShipment ?? false
  );
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [incoterm, setIncoterm] = useState<string | undefined>(
    initialValues.incoterm || undefined
  );

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

  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  const routeData = useRouteData<{
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const { company } = useUser();
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);

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
        action={path.to.salesOrderShipment(initialValues.id)}
        method="post"
        validator={salesOrderShipmentValidator}
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
                currency:
                  routeData?.salesOrder?.currencyCode ??
                  company?.baseCurrencyCode
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
            <Select
              name="incoterm"
              label={t`Incoterm`}
              isClearable
              options={incoterms.map((i) => ({ value: i, label: i }))}
              onChange={(v) => setIncoterm(v?.value as string)}
            />
            {incoterm && (
              <Input name="incotermLocation" label={t`Incoterm Location`} />
            )}

            <DatePicker name="receiptRequestedDate" label={t`Requested Date`} />
            <DatePicker name="receiptPromisedDate" label={t`Promised Date`} />
            <DatePicker name="shipmentDate" label={t`Shipment Date`} />

            <Input name="trackingNumber" label={t`Tracking Number`} />
            <Boolean
              name="dropShipment"
              label={t`Drop Shipment`}
              onChange={setDropShip}
            />
            {dropShip && (
              <>
                <Customer
                  name="customerId"
                  label={t`Customer`}
                  onChange={(value) => setCustomer(value?.value as string)}
                />
                <CustomerLocation
                  name="customerLocationId"
                  label={t`Location`}
                  customer={customer}
                />
              </>
            )}
            <CustomFormFields table="salesOrderShipment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "sales")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

SalesOrderShipmentForm.displayName = "SalesOrderShipmentForm";

export default SalesOrderShipmentForm;
