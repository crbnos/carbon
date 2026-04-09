import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  useDisclosure
} from "@carbon/react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  ItemPostingGroup,
  Number,
  Submit
} from "~/components/Form";
import { Confirm } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { itemCostValidator } from "../../items.models";

type ItemCostingFormProps = {
  initialValues: z.infer<typeof itemCostValidator>;
};

const ItemCostingForm = ({ initialValues }: ItemCostingFormProps) => {
  const [items] = useItems();
  const item = items.find((item) => item.id === initialValues.itemId);

  const replenishmentSystem = item?.replenishmentSystem ?? "Buy";
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const recalculateModal = useDisclosure();

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemCostValidator}
        defaultValues={initialValues}
        key={`${initialValues.itemId}-${initialValues.unitCost}`}
      >
        <CardHeader>
          <CardTitle>Costing & Posting</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full items-start">
            <ItemPostingGroup
              name="itemPostingGroupId"
              label="Item Group"
              helperText="Used to categorize items for reporting and analysis"
              isClearable
            />
            {/* <Select
              name="costingMethod"
              label="Part Costing Method"
              options={partCostingMethodOptions}
              onChange={(newValue) => {
                if (newValue) setItemCostingMethod(newValue.value);
              }}
            />
            <Number
              name="standardCost"
              label="Standard Cost"
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
                
              }}
              isReadOnly={partCostingMethod !== "Standard"}
            /> */}

            <Number
              name="unitCost"
              label="Unit Cost"
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              helperText={
                replenishmentSystem === "Make"
                  ? undefined
                  : "Weighted average cost over last year calculated when the invoice is posted"
              }
            />

            {/* <Boolean name="costIsAdjusted" label="Cost Is Adjusted" /> */}
            <CustomFormFields table="partCost" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
          {replenishmentSystem === "Make" && (
            <Button variant="secondary" onClick={recalculateModal.onOpen}>
              Recalculate
            </Button>
          )}
        </CardFooter>
      </ValidatedForm>
      {recalculateModal.isOpen && (
        <Confirm
          action={path.to.api.itemCostRecalculate(initialValues.itemId)}
          title="Recalculate Unit Cost"
          text="This will recalculate the unit cost from the active make method's bill of materials and processes using the batch size. The current cost will be overwritten. Do you want to continue?"
          confirmText="Recalculate"
          isOpen={recalculateModal.isOpen}
          onCancel={recalculateModal.onClose}
          onSubmit={recalculateModal.onClose}
        />
      )}
    </Card>
  );
};

export default ItemCostingForm;
