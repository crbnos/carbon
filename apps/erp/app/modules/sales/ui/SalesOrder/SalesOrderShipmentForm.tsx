// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useParams } from "react-router";
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
import {
  useCurrencyDecimals,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { incoterms } from "~/modules/shared/shared.models";
import type { action } from "~/routes/x+/sales-order+/$orderId.shipment";
import { path } from "~/utils/path";
import {
  isSalesOrderLocked,
  salesOrderShipmentValidator
} from "../../sales.models";
import type { SalesOrder } from "../../types";
import {
  type ShipByExpectation,
  useShipByRecalculatePrompt
} from "./ShipByRecalculatePrompt";

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
  const shipBy = useShipByRecalculatePrompt(initialValues.id);
  // Set on a save that changes the arrive-by date, the shipping method or the
  // ship-to: once the save lands, ask about the lines' ship-by dates.
  // The action redirects on success and on failure, so the prompt checks
  // the plan against the submitted terms (`ShipByExpectation`).
  const checkShipBy = useRef<ShipByExpectation | null>(null);
  const fetcher = useAction<typeof action>({
    onSettled: () => {
      const expectation = checkShipBy.current;
      if (!expectation) return;
      checkShipBy.current = null;
      shipBy.check(expectation);
    }
  });
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
  const currencyDecimals = useCurrencyDecimals(
    routeData?.salesOrder?.currencyCode ?? company?.baseCurrencyCode
  );
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
        onSubmit={(data) => {
          const changed =
            (data.receiptPromisedDate ?? "") !==
              (initialValues.receiptPromisedDate ?? "") ||
            (data.shippingMethodId ?? "") !==
              (initialValues.shippingMethodId ?? "") ||
            (data.customerLocationId ?? "") !==
              (initialValues.customerLocationId ?? "") ||
            !!data.dropShipment !== !!initialValues.dropShipment;
          checkShipBy.current = changed
            ? {
                arriveBy: data.receiptPromisedDate || null,
                shippingMethodId: data.shippingMethodId || null
              }
            : null;
        }}
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
              formatOptions={INPUT_FORMAT.money(
                routeData?.salesOrder?.currencyCode ??
                  company?.baseCurrencyCode,
                currencyDecimals
              )}
              ref={shippingCostRef}
            />
            <Location
              name="locationId"
              label={t`Shipment Location`}
              isReadOnly={isCustomer}
              isClearable
              termId="sales-order-shipment-from-location"
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
              termId="customer-incoterm"
            />
            {incoterm && (
              <Input name="incotermLocation" label={t`Incoterm Location`} />
            )}

            <DatePicker
              name="receiptRequestedDate"
              label={t`Requested Date`}
              termId="sales-order-shipment-receipt-requested-date"
            />
            <DatePicker
              name="receiptPromisedDate"
              label={t`Promised Date`}
              termId="sales-order-shipment-receipt-promised-date"
            />
            <DatePicker
              name="deliveryDate"
              label={t`Shipment Date`}
              termId="sales-order-shipment-date"
            />

            <Input name="trackingNumber" label={t`Tracking Number`} />
            <div className="col-span-3 max-md:col-span-full">
              <Boolean
                name="dropShipment"
                label={t`Drop Shipment`}
                bordered
                onChange={setDropShip}
                termId="drop-ship"
              />
            </div>
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
      {shipBy.prompt}
    </Card>
  );
});

SalesOrderShipmentForm.displayName = "SalesOrderShipmentForm";

export default SalesOrderShipmentForm;
