import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
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
  Submit,
  TextArea,
} from "~/components/Form";
import { warehouseTransferValidator } from "../../inventory.models";

type WarehouseTransferFormProps = {
  initialValues: z.infer<typeof warehouseTransferValidator>;
};

const WarehouseTransferForm = ({ initialValues }: WarehouseTransferFormProps) => {
  return (
    <ValidatedForm
      validator={warehouseTransferValidator}
      method="post"
      defaultValues={initialValues}
      className="w-full"
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Transfer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={4}>
            <Hidden name="id" />
            <Input name="transferId" label="Transfer ID" />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Location name="fromLocationId" label="From Location" />
              <Location name="toLocationId" label="To Location" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DatePicker name="transferDate" label="Transfer Date" />
              <DatePicker name="expectedReceiptDate" label="Expected Receipt Date" />
            </div>
            
            <Input name="reference" label="Reference" />
            <TextArea name="notes" label="Notes" />
            
            <Submit>Save Transfer</Submit>
          </VStack>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default WarehouseTransferForm;