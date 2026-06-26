import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Button,
  ChoiceCardGroup,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuBoxes,
  LuLayers,
  LuPackage,
  LuSquareUser,
  LuUsers,
  LuUsersRound
} from "react-icons/lu";
import type { z } from "zod";
import {
  Boolean as BooleanField,
  Customers,
  CustomerTypes,
  DatePicker,
  Hidden,
  Input,
  ItemPostingGroup,
  Items,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  pricingRuleAmountTypes,
  pricingRuleTypes,
  pricingRuleValidator
} from "../../sales.models";

type CustomerScopeType = "all" | "customer" | "customerType";
type ItemScopeType = "all" | "item" | "group";

type PricingRuleFormProps = {
  initialValues: z.infer<typeof pricingRuleValidator>;
  onClose: () => void;
};

const PricingRuleForm = ({ initialValues, onClose }: PricingRuleFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();

  const [amountType, setAmountType] = useState<
    (typeof pricingRuleAmountTypes)[number]
  >(initialValues.amountType ?? "Percentage");
  const [customerScope, setCustomerScope] = useState<CustomerScopeType>(() => {
    if (initialValues.customerIds && initialValues.customerIds.length > 0)
      return "customer";
    if (
      initialValues.customerTypeIds &&
      initialValues.customerTypeIds.length > 0
    )
      return "customerType";
    return "all";
  });
  const [itemScope, setItemScope] = useState<ItemScopeType>(() => {
    if (initialValues.itemIds && initialValues.itemIds.length > 0)
      return "item";
    if (initialValues.itemPostingGroupId) return "group";
    return "all";
  });
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={pricingRuleValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Pricing Rule` : t`New Pricing Rule`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Select
                  name="ruleType"
                  label={t`Rule Type`}
                  termId="pricing-rule-type"
                  options={pricingRuleTypes.map((rt) => ({
                    label: rt,
                    value: rt
                  }))}
                />
                <Select
                  name="amountType"
                  label={t`Amount Type`}
                  termId="pricing-rule-amount-type"
                  options={pricingRuleAmountTypes.map((at) => ({
                    label: at,
                    value: at
                  }))}
                  onChange={(v) => {
                    if (v)
                      setAmountType(
                        v.value as (typeof pricingRuleAmountTypes)[number]
                      );
                  }}
                />

                {amountType === "Percentage" ? (
                  <Number
                    name="amount"
                    label={t`Amount`}
                    minValue={0}
                    maxValue={1}
                    step={0.01}
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }}
                  />
                ) : (
                  <Number
                    name="amount"
                    label={t`Amount`}
                    minValue={0}
                    formatOptions={{
                      style: "currency",
                      currency: company?.baseCurrencyCode ?? "USD"
                    }}
                  />
                )}

                <BooleanField name="active" label={t`Active`} />

                <p className="text-sm font-medium text-muted-foreground pt-2">
                  {t`Scope`}
                </p>

                <ChoiceCardGroup<CustomerScopeType>
                  label={t`Customer Scope`}
                  value={customerScope}
                  onChange={setCustomerScope}
                  options={[
                    {
                      value: "all",
                      title: t`All Customers`,
                      description: t`Rule applies to every customer.`,
                      icon: <LuUsersRound />
                    },
                    {
                      value: "customer",
                      title: t`Specific Customers`,
                      description: t`Target one or more customers.`,
                      icon: <LuSquareUser />
                    },
                    {
                      value: "customerType",
                      title: t`Customer Type`,
                      description: t`Target customers by type.`,
                      icon: <LuUsers />
                    }
                  ]}
                />

                <ClearArrayField
                  name="customerIds"
                  active={customerScope === "customer"}
                />
                <ClearArrayField
                  name="customerTypeIds"
                  active={customerScope === "customerType"}
                />

                {customerScope === "customer" && (
                  <Customers
                    name="customerIds"
                    label={t`Customers`}
                    placeholder={t`Select customers`}
                  />
                )}
                {customerScope === "customerType" && (
                  <CustomerTypes
                    name="customerTypeIds"
                    label={t`Customer Types`}
                    placeholder={t`Select customer types`}
                  />
                )}

                <ChoiceCardGroup<ItemScopeType>
                  label={t`Item Scope`}
                  value={itemScope}
                  onChange={setItemScope}
                  options={[
                    {
                      value: "all",
                      title: t`All Items`,
                      description: t`Rule applies to every item.`,
                      icon: <LuLayers />
                    },
                    {
                      value: "item",
                      title: t`Specific Items`,
                      description: t`Target one or more items.`,
                      icon: <LuPackage />
                    },
                    {
                      value: "group",
                      title: t`Item Group`,
                      description: t`Target an item group.`,
                      icon: <LuBoxes />
                    }
                  ]}
                />

                <ClearArrayField name="itemIds" active={itemScope === "item"} />

                {itemScope === "item" && (
                  <Items
                    name="itemIds"
                    label={t`Items`}
                    placeholder={t`Select items`}
                  />
                )}
                {itemScope === "group" && (
                  <ItemPostingGroup
                    name="itemPostingGroupId"
                    label={t`Item Group`}
                  />
                )}
                {itemScope !== "group" && (
                  <Hidden name="itemPostingGroupId" value="" />
                )}

                <p className="text-sm font-medium text-muted-foreground pt-2">
                  {t`Optional`}
                </p>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label={t`Valid From`} />
                  <DatePicker name="validTo" label={t`Valid To`} />
                </div>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <Number
                    name="minQuantity"
                    label={t`Min Qty`}
                    termId="pricing-rule-quantity-range"
                  />
                  <Number
                    name="maxQuantity"
                    label={t`Max Qty`}
                    termId="pricing-rule-quantity-range"
                  />
                </div>

                <Number
                  name="priority"
                  label={t`Priority`}
                  helperText={t`Higher priority wins ties and applies first for markups`}
                  minValue={0}
                  step={1}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

/**
 * Clears a controlled array field when it should be inactive.
 * Must be rendered inside a ValidatedForm.
 */
function ClearArrayField({ name, active }: { name: string; active: boolean }) {
  const [, setValue] = useControlField<string[]>(name);
  useEffect(() => {
    if (!active) {
      setValue([]);
    }
  }, [active, setValue]);
  return null;
}

export default PricingRuleForm;
