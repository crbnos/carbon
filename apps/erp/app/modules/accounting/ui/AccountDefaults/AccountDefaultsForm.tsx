import { ValidatedForm } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import { Badge, Button, HStack, LabelWithHelp } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  termId: TermId;
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
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "accounting");

  // Built inside the component so labels/descriptions go through `t`. The
  // tooltip body comes from the glossary via `termId`; the on-row `description`
  // is the short context shown below the label.
  const categoryGroups: CategoryGroup[] = useMemo(
    () => [
      {
        id: "cash-banking",
        title: t`Cash & Banking`,
        description: t`Configure default accounts for cash and bank transactions`,
        fields: [
          {
            name: "bankCashAccount",
            label: t`Bank - Cash`,
            description: t`Primary cash account for bank transactions`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-bank-cash"
          },
          {
            name: "bankLocalCurrencyAccount",
            label: t`Bank - Local Currency`,
            description: t`Bank account denominated in the local currency`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-bank-local-currency"
          },
          {
            name: "bankForeignCurrencyAccount",
            label: t`Bank - Foreign Currency`,
            description: t`Bank account denominated in a foreign currency`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-bank-foreign-currency"
          }
        ]
      },
      {
        id: "receivables",
        title: t`Accounts Receivable`,
        description: t`Default accounts for customer transactions and receivables`,
        fields: [
          {
            name: "receivablesAccount",
            label: t`Receivables`,
            description: t`Accounts receivable for amounts owed by customers`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-receivables"
          },
          {
            name: "prepaymentAccount",
            label: t`Prepayments`,
            description: t`Account for advance payments made before goods or services are received`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-prepayments"
          }
        ]
      },
      {
        id: "inventory",
        title: t`Inventory`,
        description: t`Configure default accounts for inventory management`,
        fields: [
          {
            name: "inventoryAccount",
            label: t`Inventory`,
            description: t`Primary account for on-hand inventory valuation`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-inventory"
          },
          {
            name: "workInProgressAccount",
            label: t`Work in Progress (WIP)`,
            description: t`Account for production orders not yet completed`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-wip"
          },
          {
            name: "inventoryShippedNotInvoicedAccount",
            label: t`Inventory Shipped Not Invoiced`,
            description: t`Accrual for inventory shipped but not yet invoiced to customer`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-inventory-shipped-not-invoiced"
          }
        ]
      },
      {
        id: "fixed-assets",
        title: t`Fixed Assets`,
        description: t`Default accounts for long-term assets and depreciation`,
        fields: [
          {
            name: "assetAquisitionCostAccount",
            label: t`Asset Acquisition Cost`,
            description: t`Account for the purchase cost of fixed assets`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-asset-acquisition-cost"
          },
          {
            name: "assetAquisitionCostOnDisposalAccount",
            label: t`Asset Cost on Disposal`,
            description: t`Account for the cost of fixed assets when disposed`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-asset-cost-on-disposal"
          },
          {
            name: "accumulatedDepreciationAccount",
            label: t`Accumulated Depreciation`,
            description: t`Contra-asset account for total depreciation of fixed assets`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-accumulated-depreciation"
          },
          {
            name: "accumulatedDepreciationOnDisposalAccount",
            label: t`Accumulated Depreciation on Disposal`,
            description: t`Depreciation reversal when a fixed asset is disposed`,
            accountType: "balance",
            badgeType: "Asset",
            termId: "account-default-accumulated-depreciation-on-disposal"
          }
        ]
      },
      {
        id: "payables",
        title: t`Accounts Payable`,
        description: t`Configure default accounts for vendor and supplier transactions`,
        fields: [
          {
            name: "payablesAccount",
            label: t`Payables`,
            description: t`Accounts payable for amounts owed to suppliers`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-payables"
          },
          {
            name: "goodsReceivedNotInvoicedAccount",
            label: t`GR/IR Clearing`,
            description: t`Clearing account for goods received / invoice received matching`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-gr-ir"
          }
        ]
      },
      {
        id: "taxes",
        title: t`Taxes`,
        description: t`Default accounts for tax-related transactions`,
        fields: [
          {
            name: "salesTaxPayableAccount",
            label: t`Sales Tax Payable`,
            description: t`Liability account for sales tax collected from customers`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-sales-tax-payable"
          },
          {
            name: "purchaseTaxPayableAccount",
            label: t`Purchase Tax Payable`,
            description: t`Liability account for tax paid on purchases`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-purchase-tax-payable"
          },
          {
            name: "reverseChargeSalesTaxPayableAccount",
            label: t`Reverse Charge Sales Tax`,
            description: t`Tax liability for reverse-charge transactions`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-reverse-charge-sales-tax"
          },
          {
            name: "deferredTaxLiabilityAccountId",
            label: t`Deferred Tax Liability`,
            description: t`Liability account for deferred taxes from accelerated depreciation`,
            accountType: "balance",
            badgeType: "Liability",
            termId: "account-default-deferred-tax-liability"
          }
        ]
      },
      {
        id: "equity",
        title: t`Equity`,
        description: t`Configure default equity and retained earnings accounts`,
        fields: [
          {
            name: "retainedEarningsAccount",
            label: t`Retained Earnings`,
            description: t`Equity account for accumulated profits or losses`,
            accountType: "balance",
            badgeType: "Equity",
            termId: "account-default-retained-earnings"
          },
          {
            name: "currencyTranslationAccount",
            label: t`Currency Translation`,
            description: t`Equity account for currency translation adjustments (CTA)`,
            accountType: "balance",
            badgeType: "Equity",
            termId: "account-default-currency-translation"
          }
        ]
      },
      {
        id: "revenue",
        title: t`Sales & Revenue`,
        description: t`Default accounts for sales and income`,
        fields: [
          {
            name: "salesAccount",
            label: t`Sales`,
            description: t`Default account for posting sales revenue from invoices`,
            accountType: "income",
            badgeType: "Revenue",
            termId: "account-default-sales"
          },
          {
            name: "salesDiscountAccount",
            label: t`Sales Discounts`,
            description: t`Contra-revenue account for discounts given on sales`,
            accountType: "income",
            badgeType: "Revenue",
            termId: "account-default-sales-discounts"
          }
        ]
      },
      {
        id: "cogs",
        title: t`Purchasing & Cost of Goods`,
        description: t`Configure default accounts for purchasing and COGS`,
        fields: [
          {
            name: "costOfGoodsSoldAccount",
            label: t`Cost of Goods Sold`,
            description: t`Expense account for the cost of items sold`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-cogs"
          },
          {
            name: "indirectCostAccount",
            label: t`Indirect Materials & Services`,
            description: t`Expense account for non-inventory purchases (services, supplies)`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-indirect-materials-services"
          },
          {
            name: "laborAbsorptionAccount",
            label: t`Labor & Machine Absorption`,
            description: t`Credit account when labor/machine time is absorbed into WIP`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-labor-machine-absorption"
          },
          {
            name: "purchaseVarianceAccount",
            label: t`Purchase Price Variance`,
            description: t`Variance between actual purchase price and standard cost`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-purchase-price-variance"
          },
          {
            name: "inventoryAdjustmentVarianceAccount",
            label: t`Inventory Adjustment`,
            description: t`Variance from physical inventory count adjustments`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-inventory-adjustment"
          },
          {
            name: "materialVarianceAccount",
            label: t`Material Usage Variance`,
            description: t`Variance between actual and standard BOM component consumption`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-material-usage-variance"
          },
          {
            name: "laborAndMachineVarianceAccount",
            label: t`Labor & Machine Variance`,
            description: t`Variance between actual and standard routing hours and rates`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-labor-machine-variance"
          },
          {
            name: "overheadVarianceAccount",
            label: t`Overhead Variance`,
            description: t`Variance between applied and actual manufacturing overhead`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-overhead-variance"
          },
          {
            name: "lotSizeVarianceAccount",
            label: t`Lot Size Variance`,
            description: t`Fixed cost amortization variance when batch size differs from standard`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-lot-size-variance"
          },
          {
            name: "subcontractingVarianceAccount",
            label: t`Subcontracting Variance`,
            description: t`Variance in outside processing costs`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-subcontracting-variance"
          }
        ]
      },
      {
        id: "expenses",
        title: t`Operating Expenses`,
        description: t`Default accounts for business expenses`,
        fields: [
          {
            name: "maintenanceAccount",
            label: t`Maintenance Expense`,
            description: t`Expense account for equipment and facility maintenance`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-maintenance-expense"
          },
          {
            name: "assetDepreciationExpenseAccount",
            label: t`Depreciation Expense`,
            description: t`Periodic depreciation expense for fixed assets`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-depreciation-expense"
          },
          {
            name: "assetGainsAndLossesAccount",
            label: t`Gains and Losses`,
            description: t`Gains or losses recognized on disposal of fixed assets`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-gains-and-losses"
          },
          {
            name: "serviceChargeAccount",
            label: t`Service Charges`,
            description: t`Bank and financial service charge expenses`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-service-charges"
          },
          {
            name: "interestAccount",
            label: t`Interest`,
            description: t`Interest income or expense from banking activities`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-interest"
          },
          {
            name: "supplierPaymentDiscountAccount",
            label: t`Supplier Payment Discounts`,
            description: t`Discounts earned for early payment to suppliers`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-supplier-payment-discounts"
          },
          {
            name: "customerPaymentDiscountAccount",
            label: t`Customer Payment Discounts`,
            description: t`Discounts given to customers for early payment`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-customer-payment-discounts"
          },
          {
            name: "roundingAccount",
            label: t`Rounding Account`,
            description: t`Account for small rounding differences in transactions`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-rounding-account"
          },
          {
            name: "deferredTaxExpenseAccountId",
            label: t`Deferred Tax Expense`,
            description: t`Expense account for deferred tax adjustments on depreciation`,
            accountType: "income",
            badgeType: "Expense",
            termId: "account-default-deferred-tax-expense"
          }
        ]
      }
    ],
    [t]
  );

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
                            <LabelWithHelp
                              variant="inline"
                              termId={field.termId}
                            >
                              {field.label}
                            </LabelWithHelp>
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
