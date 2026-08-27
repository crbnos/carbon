import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  Submit,
  Supplier
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { repairOrderValidator } from "../../sales.models";

type RepairOrderFormProps = {
  initialValues: z.infer<typeof repairOrderValidator>;
};

const RepairOrderForm = ({ initialValues }: RepairOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <ValidatedForm
      validator={repairOrderValidator}
      method="post"
      action={
        isEditing
          ? path.to.repairOrderDetails(initialValues.id!)
          : path.to.newRepairOrder
      }
      defaultValues={initialValues}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? <Trans>Repair Order</Trans> : <Trans>New Repair Order</Trans>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer name="customerId" label={t`Customer`} />
            <CustomerLocation
              name="customerLocationId"
              label={t`Customer Location`}
              customer={initialValues.customerId}
            />
            <CustomerContact
              name="customerContactId"
              label={t`Customer Contact`}
              customer={initialValues.customerId}
            />
            <Input
              name="customerReference"
              label={t`Customer Reference`}
            />
            <Location name="locationId" label={t`Shop Location`} />
            <DatePicker name="orderDate" label={t`Opened`} />
            <DatePicker name="promisedDate" label={t`Promised`} />
            {/* The OEM that repairs the unit, when it does not stay in-house. */}
            <Supplier name="supplierId" label={t`Repair Supplier`} />
            <Input
              name="supplierReference"
              label={t`Supplier RMA Number`}
            />
            <CustomFormFields table="repairOrder" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default RepairOrderForm;
