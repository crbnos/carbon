import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useNavigate } from "@remix-run/react";
import { z } from "zod";
import { Hidden, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
} from "~/modules/accounting";
import { path } from "~/utils/path";

const defaultUnion = z.union([
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
]);

type AccountDefaultsFormProps = {
  balanceSheetAccounts: AccountListItem[];
  incomeStatementAccounts: AccountListItem[];
  initialValues: z.infer<typeof defaultUnion>;
};

const AccountDefaultsForm = ({
  balanceSheetAccounts,
  incomeStatementAccounts,
  initialValues,
}: AccountDefaultsFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "accounting");

  const incomeStatementAccountOptions = incomeStatementAccounts.map((c) => ({
    value: c.number,
    label: `${c.number} - ${c.name}`,
  }));

  const balanceSheetAccountOptions = balanceSheetAccounts.map((c) => ({
    value: c.number,
    label: `${c.number} - ${c.name}`,
  }));

  const initialIncomeStatementValues =
    defaultIncomeAcountValidator.safeParse(initialValues);
  const initialBalanceSheetValues =
    defaultBalanceSheetAccountValidator.safeParse(initialValues);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Accounts</CardTitle>
        <CardDescription>
          These accounts are used in the absence of a more specific account from
          a posting group
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="income">
          <TabsList>
            <TabsTrigger value="income">Income Statement</TabsTrigger>
            <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          </TabsList>

          <TabsContent value="income" className="py-6">
            <ValidatedForm
              validator={defaultIncomeAcountValidator}
              method="post"
              action={path.to.accountingDefaults}
              defaultValues={initialIncomeStatementValues.data}
              className="w-full flex flex-col space-y-4"
            >
              <Hidden name="intent" value="income" />
              <div className="grid gap-y-4 gap-x-8 grid-cols-1 md:grid-cols-2">
                <Select
                  name="salesAccount"
                  label="Sales"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="salesDiscountAccount"
                  label="Sales Discounts"
                  options={incomeStatementAccountOptions}
                />

                <Select
                  name="costOfGoodsSoldAccount"
                  label="Cost of Goods Sold"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="purchaseAccount"
                  label="Purchases"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="directCostAppliedAccount"
                  label="Direct Cost Applied"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="overheadCostAppliedAccount"
                  label="Overhead Cost Applied"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="purchaseVarianceAccount"
                  label="Purchase Variance"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="inventoryAdjustmentVarianceAccount"
                  label="Inventory Adjustment"
                  options={incomeStatementAccountOptions}
                />

                <Select
                  name="materialVarianceAccount"
                  label="Material Variance"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="capacityVarianceAccount"
                  label="Capacity Variance"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="overheadAccount"
                  label="Overhead"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="maintenanceAccount"
                  label="Maintenance Expense"
                  options={incomeStatementAccountOptions}
                />

                <Select
                  name="assetDepreciationExpenseAccount"
                  label="Depreciation Expense"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="assetGainsAndLossesAccount"
                  label="Gains and Losses"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="serviceChargeAccount"
                  label="Service Charges"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="interestAccount"
                  label="Interest"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="supplierPaymentDiscountAccount"
                  label="Supplier Payment Discounts"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="customerPaymentDiscountAccount"
                  label="Customer Payment Discounts"
                  options={incomeStatementAccountOptions}
                />
                <Select
                  name="roundingAccount"
                  label="Rounding Account"
                  options={incomeStatementAccountOptions}
                />
              </div>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ValidatedForm>
          </TabsContent>
          <TabsContent value="balance" className="py-6">
            <ValidatedForm
              validator={defaultBalanceSheetAccountValidator}
              method="post"
              action={path.to.accountingDefaults}
              defaultValues={initialBalanceSheetValues.data}
              className="w-full flex flex-col space-y-4"
            >
              <Hidden name="intent" value="balance" />
              <div className="grid gap-y-4 gap-x-8 grid-cols-1 md:grid-cols-2">
                <Select
                  name="inventoryAccount"
                  label="Inventory"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="inventoryInterimAccrualAccount"
                  label="Inventory Interim Accrual"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="workInProgressAccount"
                  label="Work in Progress (WIP)"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="receivablesAccount"
                  label="Receivables"
                  options={balanceSheetAccountOptions}
                />

                <Select
                  name="inventoryInvoicedNotReceivedAccount"
                  label="Inventory Invoiced Not Received"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="bankCashAccount"
                  label="Bank - Cash"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="bankLocalCurrencyAccount"
                  label="Bank - Local Currency"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="bankForeignCurrencyAccount"
                  label="Bank - Foreign Currency"
                  options={balanceSheetAccountOptions}
                />

                <Select
                  name="assetAquisitionCostAccount"
                  label="Asset Aquisition Cost"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="assetAquisitionCostOnDisposalAccount"
                  label="Asset Cost on Disposal"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="accumulatedDepreciationAccount"
                  label="Accumulated Depreciation"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="accumulatedDepreciationOnDisposalAccount"
                  label="Accumulated Depreciation on Disposal"
                  options={balanceSheetAccountOptions}
                />

                <Select
                  name="prepaymentAccount"
                  label="Prepayments"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="payablesAccount"
                  label="Payables"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="inventoryReceivedNotInvoicedAccount"
                  label="Inventory Received Not Invoiced"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="inventoryShippedNotInvoicedAccount"
                  label="Inventory Shipped Not Invoiced"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="salesTaxPayableAccount"
                  label="Sales Tax Payable"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="purchaseTaxPayableAccount"
                  label="Purchase Tax Payable"
                  options={balanceSheetAccountOptions}
                />
                <Select
                  name="reverseChargeSalesTaxPayableAccount"
                  label="Reverse Charge Sales Tax"
                  options={balanceSheetAccountOptions}
                />

                <Select
                  name="retainedEarningsAccount"
                  label="Retained Earnings"
                  options={balanceSheetAccountOptions}
                />
              </div>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ValidatedForm>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AccountDefaultsForm;
