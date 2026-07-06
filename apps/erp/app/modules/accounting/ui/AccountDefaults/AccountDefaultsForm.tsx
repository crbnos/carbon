import { ValidatedForm } from "@carbon/form";
import { Badge, Button, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Combobox, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { defaultAccountValidator } from "../../accounting.models";
import type { AccountListItem } from "../../types";

type AccountType = "income" | "balance";

type BadgeType = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

type AccountDefaultField = {
  name: string;
  label: string;
  description: string;
  accountType: AccountType;
  badgeType: BadgeType;
};

type CategoryGroup = {
  id: string;
  title: string;
  description: string;
  fields: AccountDefaultField[];
};

const badgeColors: Record<
  BadgeType,
  "green" | "red" | "blue" | "yellow" | "orange"
> = {
  Asset: "green",
  Liability: "red",
  Equity: "blue",
  Revenue: "yellow",
  Expense: "orange"
};

const categoryGroups: CategoryGroup[] = [
  // --- Assets ---
  {
    id: "cash-banking",
    title: "Cash & Banking",
    description: "Configure default accounts for cash and bank transactions",
    fields: [
      {
        name: "bankCashAccount",
        label: "Bank - Cash",
        description: "Primary cash account for bank transactions",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "bankLocalCurrencyAccount",
        label: "Bank - Local Currency",
        description: "Bank account denominated in the local currency",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "bankForeignCurrencyAccount",
        label: "Bank - Foreign Currency",
        description: "Bank account denominated in a foreign currency",
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "receivables",
    title: "Accounts Receivable",
    description: "Default accounts for customer transactions and receivables",
    fields: [
      {
        name: "receivablesAccount",
        label: "Receivables",
        description: "Accounts receivable for amounts owed by customers",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "prepaymentAccount",
        label: "Prepayments",
        description:
          "Account for advance payments made before goods or services are received",
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Configure default accounts for inventory management",
    fields: [
      {
        name: "inventoryAccount",
        label: "Inventory",
        description: "Primary account for on-hand inventory valuation",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "workInProgressAccount",
        label: "Work in Progress (WIP)",
        description: "Account for production orders not yet completed",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "inventoryShippedNotInvoicedAccount",
        label: "Inventory Shipped Not Invoiced",
        description:
          "Accrual for inventory shipped but not yet invoiced to customer",
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "fixed-assets",
    title: "Fixed Assets",
    description: "Default accounts for long-term assets and depreciation",
    fields: [
      {
        name: "assetAquisitionCostAccount",
        label: "Asset Acquisition Cost",
        description: "Account for the purchase cost of fixed assets",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "assetAquisitionCostOnDisposalAccount",
        label: "Asset Cost on Disposal",
        description: "Account for the cost of fixed assets when disposed",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "accumulatedDepreciationAccount",
        label: "Accumulated Depreciation",
        description:
          "Contra-asset account for total depreciation of fixed assets",
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "accumulatedDepreciationOnDisposalAccount",
        label: "Accumulated Depreciation on Disposal",
        description: "Depreciation reversal when a fixed asset is disposed",
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  // --- Liabilities ---
  {
    id: "payables",
    title: "Accounts Payable",
    description:
      "Configure default accounts for vendor and supplier transactions",
    fields: [
      {
        name: "payablesAccount",
        label: "Payables",
        description: "Accounts payable for amounts owed to suppliers",
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "goodsReceivedNotInvoicedAccount",
        label: "GR/IR Clearing",
        description:
          "Clearing account for goods received / invoice received matching",
        accountType: "balance",
        badgeType: "Liability"
      }
    ]
  },
  {
    id: "taxes",
    title: "Taxes",
    description: "Default accounts for tax-related transactions",
    fields: [
      {
        name: "salesTaxPayableAccount",
        label: "Sales Tax Payable",
        description: "Liability account for sales tax collected from customers",
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "purchaseTaxPayableAccount",
        label: "Purchase Tax Payable",
        description: "Liability account for tax paid on purchases",
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "reverseChargeSalesTaxPayableAccount",
        label: "Reverse Charge Sales Tax",
        description: "Tax liability for reverse-charge transactions",
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "deferredTaxLiabilityAccountId",
        label: "Deferred Tax Liability",
        description:
          "Liability account for deferred taxes from accelerated depreciation",
        accountType: "balance",
        badgeType: "Liability"
      }
    ]
  },
  // --- Equity ---
  {
    id: "equity",
    title: "Equity",
    description: "Configure default equity and retained earnings accounts",
    fields: [
      {
        name: "retainedEarningsAccount",
        label: "Retained Earnings",
        description: "Equity account for accumulated profits or losses",
        accountType: "balance",
        badgeType: "Equity"
      },
      {
        name: "currencyTranslationAccount",
        label: "Currency Translation",
        description:
          "Equity account for currency translation adjustments (CTA)",
        accountType: "balance",
        badgeType: "Equity"
      }
    ]
  },
  // --- Revenue ---
  {
    id: "revenue",
    title: "Sales & Revenue",
    description: "Default accounts for sales and income",
    fields: [
      {
        name: "salesAccount",
        label: "Sales",
        description: "Default account for posting sales revenue from invoices",
        accountType: "income",
        badgeType: "Revenue"
      },
      {
        name: "salesDiscountAccount",
        label: "Sales Discounts",
        description: "Contra-revenue account for discounts given on sales",
        accountType: "income",
        badgeType: "Revenue"
      }
    ]
  },
  // --- Expenses ---
  {
    id: "cogs",
    title: "Purchasing & Cost of Goods",
    description: "Configure default accounts for purchasing and COGS",
    fields: [
      {
        name: "costOfGoodsSoldAccount",
        label: "Cost of Goods Sold",
        description: "Expense account for the cost of items sold",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "indirectCostAccount",
        label: "Indirect Materials & Services",
        description:
          "Expense account for non-inventory purchases (services, supplies)",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "laborAbsorptionAccount",
        label: "Labor & Machine Absorption",
        description:
          "Credit account when labor/machine time is absorbed into WIP",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "purchaseVarianceAccount",
        label: "Purchase Price Variance",
        description: "Variance between actual purchase price and standard cost",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "inventoryAdjustmentVarianceAccount",
        label: "Inventory Adjustment",
        description: "Variance from physical inventory count adjustments",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "materialVarianceAccount",
        label: "Material Usage Variance",
        description:
          "Variance between actual and standard BOM component consumption",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "laborAndMachineVarianceAccount",
        label: "Labor & Machine Variance",
        description:
          "Variance between actual and standard routing hours and rates",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "overheadVarianceAccount",
        label: "Overhead Variance",
        description:
          "Variance between applied and actual manufacturing overhead",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "lotSizeVarianceAccount",
        label: "Lot Size Variance",
        description:
          "Fixed cost amortization variance when batch size differs from standard",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "subcontractingVarianceAccount",
        label: "Subcontracting Variance",
        description: "Variance in outside processing costs",
        accountType: "income",
        badgeType: "Expense"
      }
    ]
  },
  {
    id: "expenses",
    title: "Operating Expenses",
    description: "Default accounts for business expenses",
    fields: [
      {
        name: "maintenanceAccount",
        label: "Maintenance Expense",
        description: "Expense account for equipment and facility maintenance",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "assetDepreciationExpenseAccount",
        label: "Depreciation Expense",
        description: "Periodic depreciation expense for fixed assets",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "assetGainsAndLossesAccount",
        label: "Gains and Losses",
        description: "Gains or losses recognized on disposal of fixed assets",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "serviceChargeAccount",
        label: "Service Charges",
        description: "Bank and financial service charge expenses",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "interestAccount",
        label: "Interest",
        description: "Interest income or expense from banking activities",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "supplierPaymentDiscountAccount",
        label: "Supplier Payment Discounts",
        description: "Discounts earned for early payment to suppliers",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "customerPaymentDiscountAccount",
        label: "Customer Payment Discounts",
        description: "Discounts given to customers for early payment",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "roundingAccount",
        label: "Rounding Account",
        description: "Account for small rounding differences in transactions",
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "deferredTaxExpenseAccountId",
        label: "Deferred Tax Expense",
        description:
          "Expense account for deferred tax adjustments on depreciation",
        accountType: "income",
        badgeType: "Expense"
      }
    ]
  }
];

type AccountDefaultsFormProps = {
  balanceSheetAccounts: AccountListItem[];
  incomeStatementAccounts: AccountListItem[];
  initialValues: Record<string, string>;
};

const AccountDefaultsForm = ({
  balanceSheetAccounts,
  incomeStatementAccounts,
  initialValues
}: AccountDefaultsFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "accounting");

  const accountOptions: Record<
    AccountType,
    { value: string; label: string | JSX.Element }[]
  > = useMemo(
    () => ({
      income: incomeStatementAccounts.map((c) => ({
        value: c.id,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {c.number}
            </span>
            <span className="text-xs text-foreground truncate">{c.name}</span>
          </div>
        )
      })),
      balance: balanceSheetAccounts.map((c) => ({
        value: c.id,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {c.number}
            </span>
            <span className="text-xs text-foreground truncate">{c.name}</span>
          </div>
        )
      }))
    }),
    [incomeStatementAccounts, balanceSheetAccounts]
  );

  return (
    <ValidatedForm
      validator={defaultAccountValidator}
      method="post"
      action={path.to.accountingDefaults}
      defaultValues={initialValues}
      className="w-full"
    >
      <Hidden name="intent" value="all" />
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              <Trans>Default Accounts</Trans>
            </h1>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Configure the default accounts used for various transaction
                types across your system
              </Trans>
            </p>
          </div>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
            <Button size="md" variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </HStack>
        </div>
        <div className="flex flex-col gap-8 p-6">
          {categoryGroups.map((group) => (
            <div key={group.id} className="border border-border rounded-lg">
              <div className="py-6 px-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">
                  {group.title}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <div className="flex flex-col gap-3 p-4">
                {group.fields.map((field) => (
                  <div
                    key={field.name}
                    className="group rounded-lg border border-border p-4 transition-all hover:border-muted-foreground/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium text-foreground">
                            {field.label}
                          </h3>
                          <Badge variant={badgeColors[field.badgeType]}>
                            {field.badgeType}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {field.description}
                        </p>
                      </div>
                      <div className="flex-shrink-0 w-64">
                        <Combobox
                          name={field.name}
                          options={accountOptions[field.accountType]}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ValidatedForm>
  );
};

export default AccountDefaultsForm;
