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
  DatePicker,
  Hidden,
  Location,
  Number,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isQuoteLocked, quoteShipmentValidator } from "../../sales.models";
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
>(({ initialValues, defaultCollapsed = false }, ref) => {
  const { t } = useLingui();
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
    }
  }));

  const isCustomer = permissions.is("customer");

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const isLocked = isQuoteLocked(routeData?.quote?.status);
  const isEditable = !isLocked;

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
              formatOptions={{
                style: "currency",
                currency: company?.baseCurrencyCode
              }}
              minValue={0}
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

            <DatePicker name="receiptRequestedDate" label={t`Requested Date`} />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={!permissions.can("update", "sales") || !isEditable}
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

QuoteShipmentForm.displayName = "QuoteShipmentForm";

export default QuoteShipmentForm;
