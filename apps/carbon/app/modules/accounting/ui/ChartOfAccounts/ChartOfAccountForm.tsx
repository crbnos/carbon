import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  AccountCategory,
  AccountSubcategory,
  Boolean,
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountClassTypes,
  accountTypes,
  accountValidator,
  consolidatedRateTypes,
  incomeBalanceTypes,
} from "../../accounting.models";
import type {
  AccountCategory as AccountCategoryType,
  AccountClass,
  AccountIncomeBalance,
} from "../../types";

type ChartOfAccountFormProps = {
  initialValues: z.infer<typeof accountValidator>;
};

const ChartOfAccountForm = ({ initialValues }: ChartOfAccountFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [accountCategoryId, setAccountCategoryId] = useState<string>(
    initialValues.accountCategoryId ?? ""
  );
  const [incomeBalance, setIncomeBalance] = useState<AccountIncomeBalance>(
    initialValues.incomeBalance
  );
  const [accountClass, setAccountClass] = useState<AccountClass>(
    initialValues.class
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const onAccountCategoryChange = (category: AccountCategoryType | null) => {
    if (category) {
      setAccountCategoryId(category.id ?? "");
      setIncomeBalance(category.incomeBalance ?? "Income Statement");
      setAccountClass(category.class ?? "Asset");
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="full">
        <ValidatedForm
          validator={accountValidator}
          method="post"
          action={
            isEditing
              ? path.to.chartOfAccount(initialValues.id!)
              : path.to.newChartOfAccount
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? `${initialValues.number}` : "New Account"}
            </DrawerTitle>
            {isEditing && (
              <DrawerDescription>{initialValues.name}</DrawerDescription>
            )}
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
              <Input name="number" label="Account Number" />
              <Input name="name" label="Name" />
              <Select
                name="type"
                label="Type"
                options={accountTypes.map((accountType) => ({
                  label: accountType,
                  value: accountType,
                }))}
              />

              <AccountCategory
                name="accountCategoryId"
                onChange={onAccountCategoryChange}
              />
              <AccountSubcategory
                name="accountSubcategoryId"
                accountCategoryId={accountCategoryId}
              />
              <Combobox
                name="incomeBalance"
                label="Income/Balance"
                options={incomeBalanceTypes.map((incomeBalance) => ({
                  label: incomeBalance,
                  value: incomeBalance,
                }))}
                value={incomeBalance}
                onChange={(newValue) => {
                  if (newValue)
                    setIncomeBalance(newValue.value as AccountIncomeBalance);
                }}
              />
              <Combobox
                name="class"
                label="Class"
                options={accountClassTypes.map((accountClass) => ({
                  label: accountClass,
                  value: accountClass,
                }))}
                value={accountClass}
                onChange={(newValue) => {
                  if (newValue) setAccountClass(newValue.value as AccountClass);
                }}
              />
              <Select
                name="consolidatedRate"
                label="Consolidated Rate"
                options={consolidatedRateTypes.map((consolidatedRateType) => ({
                  label: consolidatedRateType,
                  value: consolidatedRateType,
                }))}
              />
              <Boolean name="directPosting" label="Direct Posting" />
              <CustomFormFields table="account" />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ChartOfAccountForm;
