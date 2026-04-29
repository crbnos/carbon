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
import { usePermissions, useRouteData } from "~/hooks";
import type { PurchaseOrder } from "~/modules/purchasing";
import {
  isPurchaseOrderLocked,
  purchaseOrderDeliveryValidator
} from "~/modules/purchasing";
import { incoterms } from "~/modules/shared";
import type { action } from "~/routes/x+/purchase-order+/$orderId.delivery";
import { path } from "~/utils/path";

type PurchaseOrderDeliveryFormProps = {
  initialValues: z.infer<typeof purchaseOrderDeliveryValidator>;
  currencyCode: string;
  defaultCollapsed?: boolean;
};

export type PurchaseOrderDeliveryFormRef = {
  focusShippingCost: () => void;
};

const PurchaseOrderDeliveryForm = forwardRef<
  PurchaseOrderDeliveryFormRef,
  PurchaseOrderDeliveryFormProps
>(({ initialValues, currencyCode, defaultCollapsed = false }, ref) => {
  const { orderId } = useParams();
  if (!orderId) {
    throw new Error("orderId not found");
  }

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
  }>(path.to.purchaseOrder(orderId));

  const isLocked = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);

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

  const isSupplier = permissions.is("supplier");

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
        action={path.to.purchaseOrderDelivery(orderId)}
        validator={purchaseOrderDeliveryValidator}
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
              name="supplierShippingCost"
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
              label={t`Delivery Location`}
              isReadOnly={isSupplier}
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
            <DatePicker name="deliveryDate" label={t`Delivery Date`} />

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
            <CustomFormFields table="purchaseOrderDelivery" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "purchasing")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

PurchaseOrderDeliveryForm.displayName = "PurchaseOrderDeliveryForm";

export default PurchaseOrderDeliveryForm;
