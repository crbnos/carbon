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
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  ItemPostingGroup,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { Confirm } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { itemCostingMethods, itemCostValidator } from "../../items.models";

type ItemCostingFormProps = {
  initialValues: z.infer<typeof itemCostValidator>;
};

const ItemCostingForm = ({ initialValues }: ItemCostingFormProps) => {
  const [items] = useItems();
  const item = items.find((item) => item.id === initialValues.itemId);

  const replenishmentSystem = item?.replenishmentSystem ?? "Buy";
  const permissions = usePermissions();
  const { t } = useLingui();
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
          <CardTitle>
            <Trans>Costing & Posting</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full items-start">
            <ItemPostingGroup
              name="itemPostingGroupId"
              label={t`Item Group`}
              termId="item-group"
              helperText={t`Used to categorize items for reporting and analysis`}
              isClearable
            />
            <Select
              name="costingMethod"
              label={t`Costing Method`}
              termId="costing-method"
              options={itemCostingMethods.map((method) => ({
                label: method,
                value: method
              }))}
            />

            <Number
              name="unitCost"
              label={t`Unit Cost`}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              helperText={
                replenishmentSystem === "Make"
                  ? undefined
                  : t`Weighted average cost over last year calculated when the invoice is posted`
              }
            />

            {/* <Boolean name="costIsAdjusted" label={t`Cost Is Adjusted`} /> */}
            <CustomFormFields table="partCost" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
          {replenishmentSystem === "Make" && (
            <Button variant="secondary" onClick={recalculateModal.onOpen}>
              <Trans>Recalculate</Trans>
            </Button>
          )}
        </CardFooter>
      </ValidatedForm>
      {recalculateModal.isOpen && (
        <Confirm
          action={path.to.api.itemCostRecalculate(initialValues.itemId)}
          title={t`Recalculate Unit Cost`}
          text={t`This will recalculate the unit cost from the active make method's bill of materials and processes using the batch size. The current cost will be overwritten. Do you want to continue?`}
          confirmText={t`Recalculate`}
          isOpen={recalculateModal.isOpen}
          onCancel={recalculateModal.onClose}
          onSubmit={recalculateModal.onClose}
        />
      )}
    </Card>
  );
};

export default ItemCostingForm;
