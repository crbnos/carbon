import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { warehouseTransferValidator } from "../../inventory.models";

type WarehouseTransferFormProps = {
  initialValues: z.infer<typeof warehouseTransferValidator>;
};

const WarehouseTransferForm = ({
  initialValues,
}: WarehouseTransferFormProps) => {
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;
  const canEdit =
    permissions.can("update", "inventory") &&
    ["Draft"].includes(initialValues.status ?? "");

  return (
    <ValidatedForm
      validator={warehouseTransferValidator}
      method="post"
      defaultValues={initialValues}
      className="w-full"
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{isEditing ? "Edit" : "New"} Transfer</CardTitle>
          {!isEditing && (
            <CardDescription>
              A warehouse transfer is an inter-company movement of inventory
              between two locations
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <VStack spacing={4}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
              {isEditing ? (
                <InputControlled
                  name="transferId"
                  label="Transfer ID"
                  isDisabled
                  value={initialValues.transferId!}
                />
              ) : (
                <SequenceOrCustomId
                  name="transferId"
                  label="Transfer ID"
                  table="warehouseTransfer"
                />
              )}
              <Input name="reference" label="Reference" />
              <Location name="fromLocationId" label="From Location" />
              <Location name="toLocationId" label="To Location" />
              {isEditing && (
                <>
                  <DatePicker name="transferDate" label="Transfer Date" />
                  <DatePicker
                    name="expectedReceiptDate"
                    label="Expected Receipt Date"
                  />
                </>
              )}
            </div>

            <TextArea name="notes" label="Notes" />

            <Submit disabled={!canEdit}>Save Transfer</Submit>
          </VStack>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default WarehouseTransferForm;
