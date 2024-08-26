import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
  cn,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Customer,
  CustomerContact,
  CustomerLocation,
  DatePicker,
  Hidden,
  Input,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { salesOrderStatusType, salesOrderValidator } from "~/modules/sales";

type SalesOrderFormValues = z.infer<typeof salesOrderValidator>;

type SalesOrderFormProps = {
  initialValues: SalesOrderFormValues;
};

const SalesOrderForm = ({ initialValues }: SalesOrderFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const statusOptions = salesOrderStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={salesOrderValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>{isEditing ? "Sales Order" : "New Sales Order"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A sales order contains information about the agreement between the
              company and a specific customer for parts and services.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="salesOrderId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-2"
              )}
            >
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                onChange={(newValue) =>
                  setCustomer(newValue?.value as string | undefined)
                }
              />
              <Input name="customerReference" label="Customer PO Number" />

              <CustomerLocation
                name="customerLocationId"
                label="Customer Location"
                customer={customer}
              />
              <CustomerContact
                name="customerContactId"
                label="Customer Contact"
                customer={customer}
              />

              <DatePicker
                name="orderDate"
                label="Order Date"
                isDisabled={isCustomer}
              />

              {isEditing && permissions.can("delete", "sales") && (
                <Select
                  name="status"
                  label="Status"
                  value={initialValues.status}
                  options={statusOptions}
                  isReadOnly={isCustomer}
                />
              )}

              <CustomFormFields table="salesOrder" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderForm;
