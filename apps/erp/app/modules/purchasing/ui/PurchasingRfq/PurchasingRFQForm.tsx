import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Location,
  SequenceOrCustomId,
  Submit,
  Suppliers
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isRfqLocked, purchasingRfqValidator } from "../../purchasing.models";
import type { PurchasingRFQ } from "../../types";

type PurchasingRFQFormValues = z.infer<typeof purchasingRfqValidator>;

type PurchasingRFQFormProps = {
  initialValues: PurchasingRFQFormValues;
};

const PurchasingRFQForm = ({ initialValues }: PurchasingRFQFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { rfqId } = useParams();
  const routeData = useRouteData<{
    rfqSummary: PurchasingRFQ;
  }>(path.to.purchasingRfq(rfqId!));
  const isEditing = initialValues.id !== undefined;
  const isLocked = isRfqLocked(routeData?.rfqSummary?.status);

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={purchasingRfqValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchasing RFQ" : "New Purchasing RFQ"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A purchasing request for quote (RFQ) is sent to suppliers to
              request pricing on a set of items and quantities.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="rfqId" />}
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              {!isEditing && (
                <SequenceOrCustomId
                  name="rfqId"
                  label={t`RFQ ID`}
                  table="purchasingRfq"
                />
              )}
              <Suppliers
                name="supplierIds"
                label={t`Suppliers`}
                termId="purchasing-rfq-suppliers"
              />
              <DatePicker name="rfqDate" label={t`RFQ Date`} />
              <DatePicker
                name="expirationDate"
                label={t`Due Date`}
                termId="purchasing-rfq-due-date"
              />
              <Location name="locationId" label={t`Receiving Location`} />
              <Employee
                name="employeeId"
                label={t`Buyer`}
                termId="purchasing-rfq-buyer"
                isOptional
              />
              <CustomFormFields table="purchasingRfq" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isLocked ||
              (isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing"))
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchasingRFQForm;
