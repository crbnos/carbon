export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ability: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          curve: Json
          id: string
          name: string
          shadowWeeks: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          curve?: Json
          id?: string
          name: string
          shadowWeeks?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          curve?: Json
          id?: string
          name?: string
          shadowWeeks?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abilities_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "abilities_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "abilities_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "abilities_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abilities_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      account: {
        Row: {
          accountCategoryId: string | null
          accountSubcategoryId: string | null
          active: boolean
          class: Database["public"]["Enums"]["glAccountClass"] | null
          companyId: string
          consolidatedRate:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt: string
          createdBy: string
          customFields: Json | null
          directPosting: boolean
          id: string
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"]
          name: string
          number: string
          type: Database["public"]["Enums"]["glAccountType"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountCategoryId?: string | null
          accountSubcategoryId?: string | null
          active?: boolean
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId: string
          consolidatedRate?:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          directPosting?: boolean
          id?: string
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"]
          name: string
          number: string
          type: Database["public"]["Enums"]["glAccountType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountCategoryId?: string | null
          accountSubcategoryId?: string | null
          active?: boolean
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId?: string
          consolidatedRate?:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          directPosting?: boolean
          id?: string
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"]
          name?: string
          number?: string
          type?: Database["public"]["Enums"]["glAccountType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      accountCategory: {
        Row: {
          category: string
          class: Database["public"]["Enums"]["glAccountClass"]
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          category: string
          class: Database["public"]["Enums"]["glAccountClass"]
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          category?: string
          class?: Database["public"]["Enums"]["glAccountClass"]
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      accountDefault: {
        Row: {
          accumulatedDepreciationAccount: string
          accumulatedDepreciationOnDisposalAccount: string
          assetAquisitionCostAccount: string
          assetAquisitionCostOnDisposalAccount: string
          assetDepreciationExpenseAccount: string
          assetGainsAndLossesAccount: string
          bankCashAccount: string
          bankForeignCurrencyAccount: string
          bankLocalCurrencyAccount: string
          capacityVarianceAccount: string
          companyId: string
          costOfGoodsSoldAccount: string
          customerPaymentDiscountAccount: string
          directCostAppliedAccount: string
          interestAccount: string
          inventoryAccount: string
          inventoryAdjustmentVarianceAccount: string
          inventoryInterimAccrualAccount: string
          inventoryInvoicedNotReceivedAccount: string
          inventoryReceivedNotInvoicedAccount: string
          inventoryShippedNotInvoicedAccount: string
          maintenanceAccount: string
          materialVarianceAccount: string
          overheadAccount: string
          overheadCostAppliedAccount: string
          payablesAccount: string
          prepaymentAccount: string
          purchaseAccount: string
          purchaseTaxPayableAccount: string
          purchaseVarianceAccount: string
          receivablesAccount: string
          retainedEarningsAccount: string
          reverseChargeSalesTaxPayableAccount: string
          roundingAccount: string
          salesAccount: string
          salesDiscountAccount: string
          salesTaxPayableAccount: string
          serviceChargeAccount: string
          supplierPaymentDiscountAccount: string
          updatedBy: string | null
          workInProgressAccount: string
        }
        Insert: {
          accumulatedDepreciationAccount: string
          accumulatedDepreciationOnDisposalAccount: string
          assetAquisitionCostAccount: string
          assetAquisitionCostOnDisposalAccount: string
          assetDepreciationExpenseAccount: string
          assetGainsAndLossesAccount: string
          bankCashAccount: string
          bankForeignCurrencyAccount: string
          bankLocalCurrencyAccount: string
          capacityVarianceAccount: string
          companyId: string
          costOfGoodsSoldAccount: string
          customerPaymentDiscountAccount: string
          directCostAppliedAccount: string
          interestAccount: string
          inventoryAccount: string
          inventoryAdjustmentVarianceAccount: string
          inventoryInterimAccrualAccount: string
          inventoryInvoicedNotReceivedAccount: string
          inventoryReceivedNotInvoicedAccount: string
          inventoryShippedNotInvoicedAccount: string
          maintenanceAccount: string
          materialVarianceAccount: string
          overheadAccount: string
          overheadCostAppliedAccount: string
          payablesAccount: string
          prepaymentAccount: string
          purchaseAccount: string
          purchaseTaxPayableAccount: string
          purchaseVarianceAccount: string
          receivablesAccount: string
          retainedEarningsAccount: string
          reverseChargeSalesTaxPayableAccount: string
          roundingAccount: string
          salesAccount: string
          salesDiscountAccount: string
          salesTaxPayableAccount: string
          serviceChargeAccount: string
          supplierPaymentDiscountAccount: string
          updatedBy?: string | null
          workInProgressAccount: string
        }
        Update: {
          accumulatedDepreciationAccount?: string
          accumulatedDepreciationOnDisposalAccount?: string
          assetAquisitionCostAccount?: string
          assetAquisitionCostOnDisposalAccount?: string
          assetDepreciationExpenseAccount?: string
          assetGainsAndLossesAccount?: string
          bankCashAccount?: string
          bankForeignCurrencyAccount?: string
          bankLocalCurrencyAccount?: string
          capacityVarianceAccount?: string
          companyId?: string
          costOfGoodsSoldAccount?: string
          customerPaymentDiscountAccount?: string
          directCostAppliedAccount?: string
          interestAccount?: string
          inventoryAccount?: string
          inventoryAdjustmentVarianceAccount?: string
          inventoryInterimAccrualAccount?: string
          inventoryInvoicedNotReceivedAccount?: string
          inventoryReceivedNotInvoicedAccount?: string
          inventoryShippedNotInvoicedAccount?: string
          maintenanceAccount?: string
          materialVarianceAccount?: string
          overheadAccount?: string
          overheadCostAppliedAccount?: string
          payablesAccount?: string
          prepaymentAccount?: string
          purchaseAccount?: string
          purchaseTaxPayableAccount?: string
          purchaseVarianceAccount?: string
          receivablesAccount?: string
          retainedEarningsAccount?: string
          reverseChargeSalesTaxPayableAccount?: string
          roundingAccount?: string
          salesAccount?: string
          salesDiscountAccount?: string
          salesTaxPayableAccount?: string
          serviceChargeAccount?: string
          supplierPaymentDiscountAccount?: string
          updatedBy?: string | null
          workInProgressAccount?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountDefault_accumulatedDepreciationAccount_fkey"
            columns: ["accumulatedDepreciationAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_accumulatedDepreciationAccount_fkey"
            columns: ["accumulatedDepreciationAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_accumulatedDepreciationOnDisposalAccount_fkey"
            columns: ["accumulatedDepreciationOnDisposalAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_accumulatedDepreciationOnDisposalAccount_fkey"
            columns: ["accumulatedDepreciationOnDisposalAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_aquisitionCostAccount_fkey"
            columns: ["assetAquisitionCostAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_aquisitionCostAccount_fkey"
            columns: ["assetAquisitionCostAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_aquisitionCostOnDisposalAccount_fkey"
            columns: ["assetAquisitionCostOnDisposalAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_aquisitionCostOnDisposalAccount_fkey"
            columns: ["assetAquisitionCostOnDisposalAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_assetDepreciationExpenseAccount_fkey"
            columns: ["assetDepreciationExpenseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_assetDepreciationExpenseAccount_fkey"
            columns: ["assetDepreciationExpenseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_assetGainsAndLossesAccount_fkey"
            columns: ["assetGainsAndLossesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_assetGainsAndLossesAccount_fkey"
            columns: ["assetGainsAndLossesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankCashAccount_fkey"
            columns: ["bankCashAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankCashAccount_fkey"
            columns: ["bankCashAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankForeignCurrencyAccount_fkey"
            columns: ["bankForeignCurrencyAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankForeignCurrencyAccount_fkey"
            columns: ["bankForeignCurrencyAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankLocalCurrencyAccount_fkey"
            columns: ["bankLocalCurrencyAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_bankLocalCurrencyAccount_fkey"
            columns: ["bankLocalCurrencyAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_capacityVarianceAccount_fkey"
            columns: ["capacityVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_capacityVarianceAccount_fkey"
            columns: ["capacityVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_costOfGoodsSoldAccount_fkey"
            columns: ["costOfGoodsSoldAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_costOfGoodsSoldAccount_fkey"
            columns: ["costOfGoodsSoldAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_customerPaymentDiscountAccount_fkey"
            columns: ["customerPaymentDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_customerPaymentDiscountAccount_fkey"
            columns: ["customerPaymentDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_directCostAppliedAccount_fkey"
            columns: ["directCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_directCostAppliedAccount_fkey"
            columns: ["directCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountDefault_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountDefault_interestAccount_fkey"
            columns: ["interestAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_interestAccount_fkey"
            columns: ["interestAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryAccount_fkey"
            columns: ["inventoryAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryAccount_fkey"
            columns: ["inventoryAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryAdjustmentVarianceAccount_fkey"
            columns: ["inventoryAdjustmentVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryAdjustmentVarianceAccount_fkey"
            columns: ["inventoryAdjustmentVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryInterimAccrualAccount_fkey"
            columns: ["inventoryInterimAccrualAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryInterimAccrualAccount_fkey"
            columns: ["inventoryInterimAccrualAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryReceivedNotInvoicedAccount_fkey"
            columns: ["inventoryReceivedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryReceivedNotInvoicedAccount_fkey"
            columns: ["inventoryReceivedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryShippedNotInvoicedAccount_fkey"
            columns: ["inventoryShippedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_inventoryShippedNotInvoicedAccount_fkey"
            columns: ["inventoryShippedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_maintenanceAccount_fkey"
            columns: ["maintenanceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_maintenanceAccount_fkey"
            columns: ["maintenanceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_materialVarianceAccount_fkey"
            columns: ["materialVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_materialVarianceAccount_fkey"
            columns: ["materialVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_overheadAccount_fkey"
            columns: ["overheadAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_overheadAccount_fkey"
            columns: ["overheadAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_overheadCostAppliedAccount_fkey"
            columns: ["overheadCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_overheadCostAppliedAccount_fkey"
            columns: ["overheadCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_payablesAccount_fkey"
            columns: ["payablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_payablesAccount_fkey"
            columns: ["payablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_prepaymentAccount_fkey"
            columns: ["prepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_prepaymentAccount_fkey"
            columns: ["prepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseAccount_fkey"
            columns: ["purchaseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseAccount_fkey"
            columns: ["purchaseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseTaxPayableAccount_fkey"
            columns: ["purchaseTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseTaxPayableAccount_fkey"
            columns: ["purchaseTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseVarianceAccount_fkey"
            columns: ["purchaseVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_purchaseVarianceAccount_fkey"
            columns: ["purchaseVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_receivablesAccount_fkey"
            columns: ["receivablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_receivablesAccount_fkey"
            columns: ["receivablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_retainedEarningsAccount_fkey"
            columns: ["retainedEarningsAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_retainedEarningsAccount_fkey"
            columns: ["retainedEarningsAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_reverseChargeSalesTaxPayableAccount_fkey"
            columns: ["reverseChargeSalesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_reverseChargeSalesTaxPayableAccount_fkey"
            columns: ["reverseChargeSalesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_roundingAccount_fkey"
            columns: ["roundingAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_roundingAccount_fkey"
            columns: ["roundingAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesAccount_fkey"
            columns: ["salesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesAccount_fkey"
            columns: ["salesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesDiscountAccount_fkey"
            columns: ["salesDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesDiscountAccount_fkey"
            columns: ["salesDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesTaxPayableAccount_fkey"
            columns: ["salesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_salesTaxPayableAccount_fkey"
            columns: ["salesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_serviceChargeAccount_fkey"
            columns: ["serviceChargeAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_serviceChargeAccount_fkey"
            columns: ["serviceChargeAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_supplierPaymentDiscountAccount_fkey"
            columns: ["supplierPaymentDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_supplierPaymentDiscountAccount_fkey"
            columns: ["supplierPaymentDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountDefault_workInProgressAccount_fkey"
            columns: ["workInProgressAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "accountDefault_workInProgressAccount_fkey"
            columns: ["workInProgressAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
        ]
      }
      accountingPeriod: {
        Row: {
          closedAt: string | null
          closedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          endDate: string
          id: string
          startDate: string
          status: Database["public"]["Enums"]["accountingPeriodStatus"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          closedAt?: string | null
          closedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          endDate: string
          id?: string
          startDate: string
          status?: Database["public"]["Enums"]["accountingPeriodStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          closedAt?: string | null
          closedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          endDate?: string
          id?: string
          startDate?: string
          status?: Database["public"]["Enums"]["accountingPeriodStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountingPeriod_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountingPeriod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountingPeriod_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountingPeriod_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountingPeriod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountingPeriod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      accountSubcategory: {
        Row: {
          accountCategoryId: string
          active: boolean
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountCategoryId: string
          active?: boolean
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountCategoryId?: string
          active?: boolean
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountSubcategory_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountSubcategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountSubcategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      address: {
        Row: {
          addressLine1: string | null
          addressLine2: string | null
          city: string | null
          companyId: string
          countryCode: number | null
          fax: string | null
          id: string
          phone: string | null
          postalCode: string | null
          state: string | null
        }
        Insert: {
          addressLine1?: string | null
          addressLine2?: string | null
          city?: string | null
          companyId: string
          countryCode?: number | null
          fax?: string | null
          id?: string
          phone?: string | null
          postalCode?: string | null
          state?: string | null
        }
        Update: {
          addressLine1?: string | null
          addressLine2?: string | null
          city?: string | null
          companyId?: string
          countryCode?: number | null
          fax?: string | null
          id?: string
          phone?: string | null
          postalCode?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "address_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "address_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["countryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
        ]
      }
      apiKey: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          id: string
          key: string
          name: string
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          id?: string
          key: string
          name: string
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          id?: string
          key?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "apiKey_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "apiKey_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "apiKey_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiKey_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      attributeDataType: {
        Row: {
          id: number
          isBoolean: boolean
          isDate: boolean
          isList: boolean
          isNumeric: boolean
          isText: boolean
          isUser: boolean
          label: string
        }
        Insert: {
          id?: number
          isBoolean?: boolean
          isDate?: boolean
          isList?: boolean
          isNumeric?: boolean
          isText?: boolean
          isUser?: boolean
          label: string
        }
        Update: {
          id?: number
          isBoolean?: boolean
          isDate?: boolean
          isList?: boolean
          isNumeric?: boolean
          isText?: boolean
          isUser?: boolean
          label?: string
        }
        Relationships: []
      }
      buyMethod: {
        Row: {
          active: boolean
          companyId: string
          conversionFactor: number
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string
          minimumOrderQuantity: number | null
          supplierId: string
          supplierPartId: string | null
          supplierUnitOfMeasureCode: string | null
          unitPrice: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          conversionFactor?: number
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          itemId: string
          minimumOrderQuantity?: number | null
          supplierId: string
          supplierPartId?: string | null
          supplierUnitOfMeasureCode?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          conversionFactor?: number
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string
          minimumOrderQuantity?: number | null
          supplierId?: string
          supplierPartId?: string | null
          supplierUnitOfMeasureCode?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buyMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "buyMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "buyMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "buyMethod_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "buyMethod_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "buyMethod_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      company: {
        Row: {
          addressLine1: string | null
          addressLine2: string | null
          city: string | null
          countryCode: string | null
          email: string | null
          fax: string | null
          id: string
          logo: string | null
          name: string
          phone: string | null
          postalCode: string | null
          state: string | null
          taxId: string | null
          updatedBy: string | null
          website: string | null
        }
        Insert: {
          addressLine1?: string | null
          addressLine2?: string | null
          city?: string | null
          countryCode?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          logo?: string | null
          name: string
          phone?: string | null
          postalCode?: string | null
          state?: string | null
          taxId?: string | null
          updatedBy?: string | null
          website?: string | null
        }
        Update: {
          addressLine1?: string | null
          addressLine2?: string | null
          city?: string | null
          countryCode?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          logo?: string | null
          name?: string
          phone?: string | null
          postalCode?: string | null
          state?: string | null
          taxId?: string | null
          updatedBy?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      companyIntegration: {
        Row: {
          active: boolean
          companyId: string
          id: string
          metadata: Json
          updatedAt: string
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          id: string
          metadata?: Json
          updatedAt?: string
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          id?: string
          metadata?: Json
          updatedAt?: string
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companyIntegration_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companyIntegration_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companyIntegration_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "companyIntegration_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "companyIntegration_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "integration"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companyIntegration_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      consumable: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "consumable_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      contact: {
        Row: {
          companyId: string
          email: string
          fax: string | null
          firstName: string
          fullName: string | null
          homePhone: string | null
          id: string
          lastName: string
          mobilePhone: string | null
          notes: string | null
          title: string | null
          workPhone: string | null
        }
        Insert: {
          companyId: string
          email: string
          fax?: string | null
          firstName: string
          fullName?: string | null
          homePhone?: string | null
          id?: string
          lastName: string
          mobilePhone?: string | null
          notes?: string | null
          title?: string | null
          workPhone?: string | null
        }
        Update: {
          companyId?: string
          email?: string
          fax?: string | null
          firstName?: string
          fullName?: string | null
          homePhone?: string | null
          id?: string
          lastName?: string
          mobilePhone?: string | null
          notes?: string | null
          title?: string | null
          workPhone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "contact_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      contractor: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          hoursPerWeek: number
          id: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          hoursPerWeek?: number
          id: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          hoursPerWeek?: number
          id?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "contractor_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "contractor_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      contractorAbility: {
        Row: {
          abilityId: string
          contractorId: string
          createdAt: string
          createdBy: string
        }
        Insert: {
          abilityId: string
          contractorId: string
          createdAt?: string
          createdBy: string
        }
        Update: {
          abilityId?: string
          contractorId?: string
          createdAt?: string
          createdBy?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractorAbility_abilityId_fkey"
            columns: ["abilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_contractorId_fkey"
            columns: ["contractorId"]
            isOneToOne: false
            referencedRelation: "contractor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_contractorId_fkey"
            columns: ["contractorId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierContactId"]
          },
          {
            foreignKeyName: "contractorAbility_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractorAbility_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      costLedger: {
        Row: {
          adjustment: boolean
          companyId: string
          cost: number
          costLedgerType: Database["public"]["Enums"]["costLedgerType"]
          costPostedToGL: number
          createdAt: string
          documentId: string | null
          documentType:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber: number
          externalDocumentId: string | null
          id: string
          itemId: string | null
          itemLedgerType: Database["public"]["Enums"]["itemLedgerType"]
          itemReadableId: string | null
          postingDate: string
          quantity: number
        }
        Insert: {
          adjustment?: boolean
          companyId: string
          cost?: number
          costLedgerType: Database["public"]["Enums"]["costLedgerType"]
          costPostedToGL?: number
          createdAt?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber?: number
          externalDocumentId?: string | null
          id?: string
          itemId?: string | null
          itemLedgerType: Database["public"]["Enums"]["itemLedgerType"]
          itemReadableId?: string | null
          postingDate?: string
          quantity?: number
        }
        Update: {
          adjustment?: boolean
          companyId?: string
          cost?: number
          costLedgerType?: Database["public"]["Enums"]["costLedgerType"]
          costPostedToGL?: number
          createdAt?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber?: number
          externalDocumentId?: string | null
          id?: string
          itemId?: string | null
          itemLedgerType?: Database["public"]["Enums"]["itemLedgerType"]
          itemReadableId?: string | null
          postingDate?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "costLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "costLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      country: {
        Row: {
          code: string
          id: number
          name: string
        }
        Insert: {
          code: string
          id?: number
          name: string
        }
        Update: {
          code?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      currency: {
        Row: {
          active: boolean
          code: string
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          decimalPlaces: number
          exchangeRate: number
          id: string
          isBaseCurrency: boolean
          name: string
          symbol: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          code: string
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          decimalPlaces?: number
          exchangeRate?: number
          id?: string
          isBaseCurrency?: boolean
          name: string
          symbol?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          decimalPlaces?: number
          exchangeRate?: number
          id?: string
          isBaseCurrency?: boolean
          name?: string
          symbol?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "currency_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "currency_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "currency_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customer: {
        Row: {
          accountManagerId: string | null
          assignee: string | null
          companyId: string
          createdAt: string
          createdBy: string | null
          customerStatusId: string | null
          customerTypeId: string | null
          customFields: Json | null
          id: string
          logo: string | null
          name: string
          taxId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountManagerId?: string | null
          assignee?: string | null
          companyId: string
          createdAt?: string
          createdBy?: string | null
          customerStatusId?: string | null
          customerTypeId?: string | null
          customFields?: Json | null
          id?: string
          logo?: string | null
          name: string
          taxId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountManagerId?: string | null
          assignee?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string | null
          customerStatusId?: string | null
          customerTypeId?: string | null
          customFields?: Json | null
          id?: string
          logo?: string | null
          name?: string
          taxId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_customerStatusId_fkey"
            columns: ["customerStatusId"]
            isOneToOne: false
            referencedRelation: "customerStatus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_customerTypeId_fkey"
            columns: ["customerTypeId"]
            isOneToOne: false
            referencedRelation: "customerType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerAccount: {
        Row: {
          companyId: string
          customerId: string
          id: string
        }
        Insert: {
          companyId: string
          customerId: string
          id: string
        }
        Update: {
          companyId?: string
          customerId?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customerAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerAccount_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerContact: {
        Row: {
          contactId: string
          customerId: string
          customerLocationId: string | null
          customFields: Json | null
          id: string
          userId: string | null
        }
        Insert: {
          contactId: string
          customerId: string
          customerLocationId?: string | null
          customFields?: Json | null
          id?: string
          userId?: string | null
        }
        Update: {
          contactId?: string
          customerId?: string
          customerLocationId?: string | null
          customFields?: Json | null
          id?: string
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customerContact_contactId_fkey"
            columns: ["contactId"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerLocation: {
        Row: {
          addressId: string
          customerId: string
          customFields: Json | null
          id: string
          name: string
        }
        Insert: {
          addressId: string
          customerId: string
          customFields?: Json | null
          id?: string
          name: string
        }
        Update: {
          addressId?: string
          customerId?: string
          customFields?: Json | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "customerLocation_addressId_fkey"
            columns: ["addressId"]
            isOneToOne: false
            referencedRelation: "address"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerLocation_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerLocation_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerLocation_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
        ]
      }
      customerPartToItem: {
        Row: {
          companyId: string
          customerId: string
          customerPartId: string
          customerPartRevision: string | null
          id: string
          itemId: string
        }
        Insert: {
          companyId: string
          customerId: string
          customerPartId: string
          customerPartRevision?: string | null
          id?: string
          itemId: string
        }
        Update: {
          companyId?: string
          customerId?: string
          customerPartId?: string
          customerPartRevision?: string | null
          id?: string
          itemId?: string
        }
        Relationships: [
          {
            foreignKeyName: "customerPartToItem_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPartToItem_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPartToItem_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerPartToItem_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerPartToItem_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPartToItem_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPartToItem_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPartToItem_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
        ]
      }
      customerPayment: {
        Row: {
          companyId: string
          currencyCode: string | null
          customerId: string
          invoiceCustomerContactId: string | null
          invoiceCustomerId: string | null
          invoiceCustomerLocationId: string | null
          paymentTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          currencyCode?: string | null
          customerId: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          currencyCode?: string | null
          customerId?: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customerPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerPayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "customerPayment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_invoiceCustomerContactId_fkey"
            columns: ["invoiceCustomerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_invoiceCustomerLocationId_fkey"
            columns: ["invoiceCustomerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerShipping: {
        Row: {
          companyId: string
          customerId: string
          shippingCustomerContactId: string | null
          shippingCustomerId: string | null
          shippingCustomerLocationId: string | null
          shippingMethodId: string | null
          shippingTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          customerId: string
          shippingCustomerContactId?: string | null
          shippingCustomerId?: string | null
          shippingCustomerLocationId?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          customerId?: string
          shippingCustomerContactId?: string | null
          shippingCustomerId?: string | null
          shippingCustomerLocationId?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customerShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerShipping_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: true
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingCustomerContactId_fkey"
            columns: ["shippingCustomerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingCustomerId_fkey"
            columns: ["shippingCustomerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingCustomerId_fkey"
            columns: ["shippingCustomerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingCustomerId_fkey"
            columns: ["shippingCustomerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingCustomerLocationId_fkey"
            columns: ["shippingCustomerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingMethodId_fkey"
            columns: ["shippingMethodId"]
            isOneToOne: false
            referencedRelation: "shippingMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_shippingTermId_fkey"
            columns: ["shippingTermId"]
            isOneToOne: false
            referencedRelation: "shippingTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerStatus: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customerStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customerStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customerType: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          protected: boolean
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          protected?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          protected?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customerType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customerType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customerType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customerType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customField: {
        Row: {
          active: boolean | null
          companyId: string
          createdAt: string
          createdBy: string
          dataTypeId: number
          id: string
          listOptions: string[] | null
          name: string
          sortOrder: number
          table: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean | null
          companyId: string
          createdAt?: string
          createdBy: string
          dataTypeId: number
          id?: string
          listOptions?: string[] | null
          name: string
          sortOrder?: number
          table: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          dataTypeId?: number
          id?: string
          listOptions?: string[] | null
          name?: string
          sortOrder?: number
          table?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customField_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customField_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customField_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customField_customFieldTable_fkey"
            columns: ["table"]
            isOneToOne: false
            referencedRelation: "customFieldTable"
            referencedColumns: ["table"]
          },
          {
            foreignKeyName: "customField_customFieldTable_fkey"
            columns: ["table"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["table"]
          },
          {
            foreignKeyName: "customField_dataTypeId_fkey"
            columns: ["dataTypeId"]
            isOneToOne: false
            referencedRelation: "attributeDataType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customField_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customFieldTable: {
        Row: {
          module: Database["public"]["Enums"]["module"]
          name: string
          table: string
        }
        Insert: {
          module: Database["public"]["Enums"]["module"]
          name: string
          table: string
        }
        Update: {
          module?: Database["public"]["Enums"]["module"]
          name?: string
          table?: string
        }
        Relationships: []
      }
      department: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          parentDepartmentId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          parentDepartmentId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          parentDepartmentId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "department_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "department_parentDepartmentId_fkey"
            columns: ["parentDepartmentId"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
        ]
      }
      document: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          description: string | null
          extension: string | null
          id: string
          name: string
          path: string
          readGroups: string[] | null
          size: number
          sourceDocument:
            | Database["public"]["Enums"]["documentSourceType"]
            | null
          sourceDocumentId: string | null
          type: Database["public"]["Enums"]["documentType"]
          updatedAt: string | null
          updatedBy: string | null
          writeGroups: string[] | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          description?: string | null
          extension?: string | null
          id?: string
          name: string
          path: string
          readGroups?: string[] | null
          size: number
          sourceDocument?:
            | Database["public"]["Enums"]["documentSourceType"]
            | null
          sourceDocumentId?: string | null
          type: Database["public"]["Enums"]["documentType"]
          updatedAt?: string | null
          updatedBy?: string | null
          writeGroups?: string[] | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          description?: string | null
          extension?: string | null
          id?: string
          name?: string
          path?: string
          readGroups?: string[] | null
          size?: number
          sourceDocument?:
            | Database["public"]["Enums"]["documentSourceType"]
            | null
          sourceDocumentId?: string | null
          type?: Database["public"]["Enums"]["documentType"]
          updatedAt?: string | null
          updatedBy?: string | null
          writeGroups?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      documentFavorite: {
        Row: {
          documentId: string
          userId: string
        }
        Insert: {
          documentId: string
          userId: string
        }
        Update: {
          documentId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentFavorites_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      documentLabel: {
        Row: {
          documentId: string
          label: string
          userId: string
        }
        Insert: {
          documentId: string
          label: string
          userId: string
        }
        Update: {
          documentId?: string
          label?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentLabels_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      documentTransaction: {
        Row: {
          createdAt: string
          documentId: string
          id: string
          type: Database["public"]["Enums"]["documentTransactionType"]
          userId: string
        }
        Insert: {
          createdAt?: string
          documentId: string
          id?: string
          type: Database["public"]["Enums"]["documentTransactionType"]
          userId: string
        }
        Update: {
          createdAt?: string
          documentId?: string
          id?: string
          type?: Database["public"]["Enums"]["documentTransactionType"]
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentTransaction_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_documentId_fkey"
            columns: ["documentId"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      employee: {
        Row: {
          companyId: string
          employeeTypeId: string
          id: string
        }
        Insert: {
          companyId: string
          employeeTypeId: string
          id: string
        }
        Update: {
          companyId?: string
          employeeTypeId?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employee_employeeTypeId_fkey"
            columns: ["employeeTypeId"]
            isOneToOne: false
            referencedRelation: "employeeType"
            referencedColumns: ["id"]
          },
        ]
      }
      employeeAbility: {
        Row: {
          abilityId: string
          active: boolean
          employeeId: string
          id: string
          lastTrainingDate: string | null
          trainingCompleted: boolean | null
          trainingDays: number
        }
        Insert: {
          abilityId: string
          active?: boolean
          employeeId: string
          id?: string
          lastTrainingDate?: string | null
          trainingCompleted?: boolean | null
          trainingDays?: number
        }
        Update: {
          abilityId?: string
          active?: boolean
          employeeId?: string
          id?: string
          lastTrainingDate?: string | null
          trainingCompleted?: boolean | null
          trainingDays?: number
        }
        Relationships: [
          {
            foreignKeyName: "employeeAbilities_abilityId_fkey"
            columns: ["abilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeAbilities_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeAbilities_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeAbilities_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeAbilities_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeAbilities_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      employeeJob: {
        Row: {
          companyId: string
          customFields: Json | null
          departmentId: string | null
          id: string
          locationId: string | null
          managerId: string | null
          shiftId: string | null
          startDate: string | null
          title: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          customFields?: Json | null
          departmentId?: string | null
          id: string
          locationId?: string | null
          managerId?: string | null
          shiftId?: string | null
          startDate?: string | null
          title?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          customFields?: Json | null
          departmentId?: string | null
          id?: string
          locationId?: string | null
          managerId?: string | null
          shiftId?: string | null
          startDate?: string | null
          title?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employeeJob_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employeeJob_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employeeJob_departmentId_fkey"
            columns: ["departmentId"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "employeeJob_managerId_fkey"
            columns: ["managerId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_managerId_fkey"
            columns: ["managerId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_managerId_fkey"
            columns: ["managerId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_managerId_fkey"
            columns: ["managerId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_managerId_fkey"
            columns: ["managerId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "employeeJob_shiftId_fkey"
            columns: ["shiftId"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_shiftId_fkey"
            columns: ["shiftId"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      employeeShift: {
        Row: {
          employeeId: string
          id: string
          shiftId: string
        }
        Insert: {
          employeeId: string
          id?: string
          shiftId: string
        }
        Update: {
          employeeId?: string
          id?: string
          shiftId?: string
        }
        Relationships: [
          {
            foreignKeyName: "employeeShift_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeShift_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeShift_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeShift_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeShift_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "employeeShift_shiftId_fkey"
            columns: ["shiftId"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeShift_shiftId_fkey"
            columns: ["shiftId"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      employeeType: {
        Row: {
          companyId: string
          createdAt: string
          id: string
          name: string
          protected: boolean
          updatedAt: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          id?: string
          name: string
          protected?: boolean
          updatedAt?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          id?: string
          name?: string
          protected?: boolean
          updatedAt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employeeType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employeeType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      employeeTypePermission: {
        Row: {
          create: string[]
          createdAt: string
          delete: string[]
          employeeTypeId: string
          module: Database["public"]["Enums"]["module"]
          update: string[]
          updatedAt: string | null
          view: string[]
        }
        Insert: {
          create?: string[]
          createdAt?: string
          delete?: string[]
          employeeTypeId: string
          module: Database["public"]["Enums"]["module"]
          update?: string[]
          updatedAt?: string | null
          view?: string[]
        }
        Update: {
          create?: string[]
          createdAt?: string
          delete?: string[]
          employeeTypeId?: string
          module?: Database["public"]["Enums"]["module"]
          update?: string[]
          updatedAt?: string | null
          view?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "employeeTypePermission_new_employeeTypeId_fkey"
            columns: ["employeeTypeId"]
            isOneToOne: false
            referencedRelation: "employeeType"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscalYearSettings: {
        Row: {
          companyId: string
          startMonth: Database["public"]["Enums"]["month"]
          taxStartMonth: Database["public"]["Enums"]["month"]
          updatedBy: string
        }
        Insert: {
          companyId: string
          startMonth?: Database["public"]["Enums"]["month"]
          taxStartMonth?: Database["public"]["Enums"]["month"]
          updatedBy: string
        }
        Update: {
          companyId?: string
          startMonth?: Database["public"]["Enums"]["month"]
          taxStartMonth?: Database["public"]["Enums"]["month"]
          updatedBy?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscalYearSettings_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fiscalYearSettings_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fiscalYearSettings_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscalYearSettings_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      fixture: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customerId: string | null
          customFields: Json | null
          id: string
          itemId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customerId?: string | null
          customFields?: Json | null
          id: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customerId?: string | null
          customFields?: Json | null
          id?: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      group: {
        Row: {
          companyId: string | null
          createdAt: string
          id: string
          isCustomerOrgGroup: boolean
          isCustomerTypeGroup: boolean
          isEmployeeTypeGroup: boolean
          isIdentityGroup: boolean
          isSupplierOrgGroup: boolean
          isSupplierTypeGroup: boolean
          name: string
          updatedAt: string | null
        }
        Insert: {
          companyId?: string | null
          createdAt?: string
          id?: string
          isCustomerOrgGroup?: boolean
          isCustomerTypeGroup?: boolean
          isEmployeeTypeGroup?: boolean
          isIdentityGroup?: boolean
          isSupplierOrgGroup?: boolean
          isSupplierTypeGroup?: boolean
          name: string
          updatedAt?: string | null
        }
        Update: {
          companyId?: string | null
          createdAt?: string
          id?: string
          isCustomerOrgGroup?: boolean
          isCustomerTypeGroup?: boolean
          isEmployeeTypeGroup?: boolean
          isIdentityGroup?: boolean
          isSupplierOrgGroup?: boolean
          isSupplierTypeGroup?: boolean
          name?: string
          updatedAt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      holiday: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          date: string
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
          year: number | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          date: string
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
          year?: number | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          date?: string
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "holiday_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "holiday_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      integration: {
        Row: {
          description: string | null
          id: string
          jsonschema: Json
          logoPath: string | null
          title: string
          visible: boolean
        }
        Insert: {
          description?: string | null
          id: string
          jsonschema: Json
          logoPath?: string | null
          title: string
          visible?: boolean
        }
        Update: {
          description?: string | null
          id?: string
          jsonschema?: Json
          logoPath?: string | null
          title?: string
          visible?: boolean
        }
        Relationships: []
      }
      item: {
        Row: {
          active: boolean
          assignee: string | null
          companyId: string | null
          createdAt: string
          createdBy: string
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          id: string
          itemTrackingType: Database["public"]["Enums"]["itemTrackingType"]
          modelUploadId: string | null
          name: string
          readableId: string
          replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"]
          type: Database["public"]["Enums"]["itemType"]
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          assignee?: string | null
          companyId?: string | null
          createdAt?: string
          createdBy: string
          defaultMethodType?: Database["public"]["Enums"]["methodType"] | null
          description?: string | null
          id?: string
          itemTrackingType: Database["public"]["Enums"]["itemTrackingType"]
          modelUploadId?: string | null
          name: string
          readableId: string
          replenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"]
          type: Database["public"]["Enums"]["itemType"]
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          assignee?: string | null
          companyId?: string | null
          createdAt?: string
          createdBy?: string
          defaultMethodType?: Database["public"]["Enums"]["methodType"] | null
          description?: string | null
          id?: string
          itemTrackingType?: Database["public"]["Enums"]["itemTrackingType"]
          modelUploadId?: string | null
          name?: string
          readableId?: string
          replenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"]
          type?: Database["public"]["Enums"]["itemType"]
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "item_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "item_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "item_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "item_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "item_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      itemCost: {
        Row: {
          companyId: string
          costingMethod: Database["public"]["Enums"]["itemCostingMethod"]
          costIsAdjusted: boolean
          createdAt: string
          createdBy: string
          customFields: Json | null
          itemId: string
          itemPostingGroupId: string | null
          standardCost: number
          unitCost: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          costingMethod: Database["public"]["Enums"]["itemCostingMethod"]
          costIsAdjusted?: boolean
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          itemId: string
          itemPostingGroupId?: string | null
          standardCost?: number
          unitCost?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          costingMethod?: Database["public"]["Enums"]["itemCostingMethod"]
          costIsAdjusted?: boolean
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          itemId?: string
          itemPostingGroupId?: string | null
          standardCost?: number
          unitCost?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemCost_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemCost_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemCost_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemCost_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemCost_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemCost_itemPostingGroupId_fkey"
            columns: ["itemPostingGroupId"]
            isOneToOne: false
            referencedRelation: "itemPostingGroup"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      itemInventory: {
        Row: {
          companyId: string
          id: string
          itemId: string
          locationId: string | null
          quantityOnHand: number
          quantityOnProductionOrder: number
          quantityOnPurchase: number
          quantityOnSalesOrder: number
          shelfId: string | null
        }
        Insert: {
          companyId: string
          id?: string
          itemId: string
          locationId?: string | null
          quantityOnHand?: number
          quantityOnProductionOrder?: number
          quantityOnPurchase?: number
          quantityOnSalesOrder?: number
          shelfId?: string | null
        }
        Update: {
          companyId?: string
          id?: string
          itemId?: string
          locationId?: string | null
          quantityOnHand?: number
          quantityOnProductionOrder?: number
          quantityOnPurchase?: number
          quantityOnSalesOrder?: number
          shelfId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemInventory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemInventory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemInventory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemInventory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemInventory_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemInventory_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
        ]
      }
      itemLedger: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          documentId: string | null
          documentType:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber: number
          entryType: Database["public"]["Enums"]["itemLedgerType"]
          externalDocumentId: string | null
          id: string
          itemId: string
          itemReadableId: string | null
          locationId: string | null
          postingDate: string
          quantity: number
          shelfId: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber?: number
          entryType: Database["public"]["Enums"]["itemLedgerType"]
          externalDocumentId?: string | null
          id?: string
          itemId: string
          itemReadableId?: string | null
          locationId?: string | null
          postingDate?: string
          quantity: number
          shelfId?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["itemLedgerDocumentType"]
            | null
          entryNumber?: number
          entryType?: Database["public"]["Enums"]["itemLedgerType"]
          externalDocumentId?: string | null
          id?: string
          itemId?: string
          itemReadableId?: string | null
          locationId?: string | null
          postingDate?: string
          quantity?: number
          shelfId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemLedger_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemLedger_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemLedger_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemLedger_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemLedger_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partLeger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partLeger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partLeger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "partLeger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      itemPlanning: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          critical: boolean
          customFields: Json | null
          demandAccumulationIncludesInventory: boolean
          demandAccumulationPeriod: number
          demandReschedulingPeriod: number
          itemId: string
          locationId: string
          maximumOrderQuantity: number
          minimumOrderQuantity: number
          orderMultiple: number
          reorderingPolicy: Database["public"]["Enums"]["itemReorderingPolicy"]
          reorderMaximumInventory: number
          reorderPoint: number
          reorderQuantity: number
          safetyStockLeadTime: number
          safetyStockQuantity: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          critical?: boolean
          customFields?: Json | null
          demandAccumulationIncludesInventory?: boolean
          demandAccumulationPeriod?: number
          demandReschedulingPeriod?: number
          itemId: string
          locationId: string
          maximumOrderQuantity?: number
          minimumOrderQuantity?: number
          orderMultiple?: number
          reorderingPolicy?: Database["public"]["Enums"]["itemReorderingPolicy"]
          reorderMaximumInventory?: number
          reorderPoint?: number
          reorderQuantity?: number
          safetyStockLeadTime?: number
          safetyStockQuantity?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          critical?: boolean
          customFields?: Json | null
          demandAccumulationIncludesInventory?: boolean
          demandAccumulationPeriod?: number
          demandReschedulingPeriod?: number
          itemId?: string
          locationId?: string
          maximumOrderQuantity?: number
          minimumOrderQuantity?: number
          orderMultiple?: number
          reorderingPolicy?: Database["public"]["Enums"]["itemReorderingPolicy"]
          reorderMaximumInventory?: number
          reorderPoint?: number
          reorderQuantity?: number
          safetyStockLeadTime?: number
          safetyStockQuantity?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemPlanning_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemPlanning_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemPlanning_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemPlanning_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemPlanning_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "itemPlanning_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPlanning_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      itemPostingGroup: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description?: string | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemPostingGroup_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemPostingGroup_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemPostingGroup_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      itemReplenishment: {
        Row: {
          companyId: string
          conversionFactor: number
          createdAt: string
          createdBy: string
          customFields: Json | null
          itemId: string
          lotSize: number | null
          manufacturingBlocked: boolean
          preferredSupplierId: string | null
          purchasingBlocked: boolean
          purchasingLeadTime: number
          purchasingUnitOfMeasureCode: string | null
          requiresConfiguration: boolean
          scrapPercentage: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          conversionFactor?: number
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          itemId: string
          lotSize?: number | null
          manufacturingBlocked?: boolean
          preferredSupplierId?: string | null
          purchasingBlocked?: boolean
          purchasingLeadTime?: number
          purchasingUnitOfMeasureCode?: string | null
          requiresConfiguration?: boolean
          scrapPercentage?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          conversionFactor?: number
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          itemId?: string
          lotSize?: number | null
          manufacturingBlocked?: boolean
          preferredSupplierId?: string | null
          purchasingBlocked?: boolean
          purchasingLeadTime?: number
          purchasingUnitOfMeasureCode?: string | null
          requiresConfiguration?: boolean
          scrapPercentage?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemReplenishment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemReplenishment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemReplenishment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemReplenishment_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: true
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_preferredSupplierId_fkey"
            columns: ["preferredSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "itemReplenishment_preferredSupplierId_fkey"
            columns: ["preferredSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "itemReplenishment_preferredSupplierId_fkey"
            columns: ["preferredSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_preferredSupplierId_fkey"
            columns: ["preferredSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_preferredSupplierId_fkey"
            columns: ["preferredSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_purchaseUnitOfMeasureCode_fkey"
            columns: ["purchasingUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "itemReplenishment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemReplenishment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      itemUnitSalePrice: {
        Row: {
          allowInvoiceDiscount: boolean
          companyId: string
          createdAt: string
          createdBy: string
          currencyCode: string
          customFields: Json | null
          itemId: string
          priceIncludesTax: boolean
          salesBlocked: boolean
          salesUnitOfMeasureCode: string | null
          unitSalePrice: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          allowInvoiceDiscount?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          currencyCode: string
          customFields?: Json | null
          itemId: string
          priceIncludesTax?: boolean
          salesBlocked?: boolean
          salesUnitOfMeasureCode?: string | null
          unitSalePrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          allowInvoiceDiscount?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          currencyCode?: string
          customFields?: Json | null
          itemId?: string
          priceIncludesTax?: boolean
          salesBlocked?: boolean
          salesUnitOfMeasureCode?: string | null
          unitSalePrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itemUnitSalePrice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_salesUnitOfMeasureId_fkey"
            columns: ["salesUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itemUnitSalePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      job: {
        Row: {
          assignee: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customerId: string | null
          customFields: Json | null
          deadlineType: Database["public"]["Enums"]["deadlineType"]
          dueDate: string | null
          id: string
          itemId: string
          jobId: string
          locationId: string
          modelUploadId: string | null
          notes: Json | null
          productionQuantity: number | null
          quantity: number
          quantityComplete: number
          quantityReceivedToInventory: number
          quantityShipped: number
          quoteId: string | null
          quoteLineId: string | null
          salesOrderId: string | null
          salesOrderLineId: string | null
          scrapQuantity: number
          status: Database["public"]["Enums"]["jobStatus"]
          unitOfMeasureCode: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customerId?: string | null
          customFields?: Json | null
          deadlineType?: Database["public"]["Enums"]["deadlineType"]
          dueDate?: string | null
          id?: string
          itemId: string
          jobId: string
          locationId: string
          modelUploadId?: string | null
          notes?: Json | null
          productionQuantity?: number | null
          quantity?: number
          quantityComplete?: number
          quantityReceivedToInventory?: number
          quantityShipped?: number
          quoteId?: string | null
          quoteLineId?: string | null
          salesOrderId?: string | null
          salesOrderLineId?: string | null
          scrapQuantity?: number
          status?: Database["public"]["Enums"]["jobStatus"]
          unitOfMeasureCode: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customerId?: string | null
          customFields?: Json | null
          deadlineType?: Database["public"]["Enums"]["deadlineType"]
          dueDate?: string | null
          id?: string
          itemId?: string
          jobId?: string
          locationId?: string
          modelUploadId?: string | null
          notes?: Json | null
          productionQuantity?: number | null
          quantity?: number
          quantityComplete?: number
          quantityReceivedToInventory?: number
          quantityShipped?: number
          quoteId?: string | null
          quoteLineId?: string | null
          salesOrderId?: string | null
          salesOrderLineId?: string | null
          scrapQuantity?: number
          status?: Database["public"]["Enums"]["jobStatus"]
          unitOfMeasureCode?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderLineId_fkey"
            columns: ["salesOrderLineId"]
            isOneToOne: false
            referencedRelation: "salesOrderLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderLineId_fkey"
            columns: ["salesOrderLineId"]
            isOneToOne: false
            referencedRelation: "salesOrderLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      jobFavorite: {
        Row: {
          jobId: string
          userId: string
        }
        Insert: {
          jobId: string
          userId: string
        }
        Update: {
          jobId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobFavorites_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      jobMakeMethod: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string
          jobId: string
          parentMaterialId: string | null
          quantityPerParent: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          itemId: string
          jobId: string
          parentMaterialId?: string | null
          quantityPerParent?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string
          jobId?: string
          parentMaterialId?: string | null
          quantityPerParent?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobMakeMethod_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_parentMaterialId_fkey"
            columns: ["parentMaterialId"]
            isOneToOne: false
            referencedRelation: "jobMaterial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_parentMaterialId_fkey"
            columns: ["parentMaterialId"]
            isOneToOne: false
            referencedRelation: "jobMaterialWithMakeMethodId"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      jobMaterial: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string
          estimatedQuantity: number | null
          id: string
          itemId: string
          itemReadableId: string
          itemType: string
          jobId: string
          jobMakeMethodId: string
          jobOperationId: string | null
          methodType: Database["public"]["Enums"]["methodType"]
          order: number
          quantity: number
          scrapQuantity: number
          unitCost: number
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description: string
          estimatedQuantity?: number | null
          id?: string
          itemId: string
          itemReadableId: string
          itemType?: string
          jobId: string
          jobMakeMethodId: string
          jobOperationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          quantity?: number
          scrapQuantity?: number
          unitCost?: number
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string
          estimatedQuantity?: number | null
          id?: string
          itemId?: string
          itemReadableId?: string
          itemType?: string
          jobId?: string
          jobMakeMethodId?: string
          jobOperationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          quantity?: number
          scrapQuantity?: number
          unitCost?: number
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobMaterial_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMaterialWithMakeMethodId"
            referencedColumns: ["jobMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "jobMaterial_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      jobOperation: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string | null
          id: string
          jobId: string
          jobMakeMethodId: string | null
          laborRate: number
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineRate: number | null
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationLeadTime: number
          operationMinimumCost: number
          operationOrder: Database["public"]["Enums"]["methodOperationOrder"]
          operationQuantity: number | null
          operationSupplierProcessId: string | null
          operationType: Database["public"]["Enums"]["operationType"]
          operationUnitCost: number
          order: number
          overheadRate: number
          processId: string
          quantityComplete: number | null
          quantityReworked: number | null
          quantityScrapped: number | null
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          status: Database["public"]["Enums"]["jobOperationStatus"]
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
          workInstruction: Json
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description?: string | null
          id?: string
          jobId: string
          jobMakeMethodId?: string | null
          laborRate?: number
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineRate?: number | null
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          operationLeadTime?: number
          operationMinimumCost?: number
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationQuantity?: number | null
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          operationUnitCost?: number
          order?: number
          overheadRate?: number
          processId: string
          quantityComplete?: number | null
          quantityReworked?: number | null
          quantityScrapped?: number | null
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          status?: Database["public"]["Enums"]["jobOperationStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string | null
          id?: string
          jobId?: string
          jobMakeMethodId?: string | null
          laborRate?: number
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineRate?: number | null
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          operationLeadTime?: number
          operationMinimumCost?: number
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationQuantity?: number | null
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          operationUnitCost?: number
          order?: number
          overheadRate?: number
          processId?: string
          quantityComplete?: number | null
          quantityReworked?: number | null
          quantityScrapped?: number | null
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          status?: Database["public"]["Enums"]["jobOperationStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobOperation_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMaterialWithMakeMethodId"
            referencedColumns: ["jobMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "jobOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
      journal: {
        Row: {
          accountingPeriodId: string | null
          companyId: string
          createdAt: string
          customFields: Json | null
          description: string | null
          id: number
          postingDate: string
        }
        Insert: {
          accountingPeriodId?: string | null
          companyId: string
          createdAt?: string
          customFields?: Json | null
          description?: string | null
          id?: number
          postingDate?: string
        }
        Update: {
          accountingPeriodId?: string | null
          companyId?: string
          createdAt?: string
          customFields?: Json | null
          description?: string | null
          id?: number
          postingDate?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_accountPeriodId_fkey"
            columns: ["accountingPeriodId"]
            isOneToOne: false
            referencedRelation: "accountingPeriod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "journal_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      journalLine: {
        Row: {
          accountNumber: string
          accrual: boolean
          amount: number
          companyId: string
          createdAt: string
          customFields: Json | null
          description: string | null
          documentId: string | null
          documentLineReference: string | null
          documentType:
            | Database["public"]["Enums"]["journalLineDocumentType"]
            | null
          externalDocumentId: string | null
          id: string
          journalId: number
          journalLineReference: string
          quantity: number
        }
        Insert: {
          accountNumber: string
          accrual?: boolean
          amount: number
          companyId: string
          createdAt?: string
          customFields?: Json | null
          description?: string | null
          documentId?: string | null
          documentLineReference?: string | null
          documentType?:
            | Database["public"]["Enums"]["journalLineDocumentType"]
            | null
          externalDocumentId?: string | null
          id?: string
          journalId: number
          journalLineReference: string
          quantity?: number
        }
        Update: {
          accountNumber?: string
          accrual?: boolean
          amount?: number
          companyId?: string
          createdAt?: string
          customFields?: Json | null
          description?: string | null
          documentId?: string | null
          documentLineReference?: string | null
          documentType?:
            | Database["public"]["Enums"]["journalLineDocumentType"]
            | null
          externalDocumentId?: string | null
          id?: string
          journalId?: number
          journalLineReference?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "journalLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "journalLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "journalLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journalLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journalLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "journalLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      location: {
        Row: {
          addressLine1: string
          addressLine2: string | null
          city: string
          companyId: string
          countryCode: string | null
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          postalCode: string
          state: string
          timezone: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          addressLine1: string
          addressLine2?: string | null
          city: string
          companyId: string
          countryCode?: string | null
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          postalCode: string
          state: string
          timezone: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          addressLine1?: string
          addressLine2?: string | null
          city?: string
          companyId?: string
          countryCode?: string | null
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          postalCode?: string
          state?: string
          timezone?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      makeMethod: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          itemId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "method_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "method_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "method_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "method_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
        ]
      }
      material: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          dimensions: string | null
          finish: string | null
          grade: string | null
          id: string
          itemId: string | null
          materialFormId: string
          materialSubstanceId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          dimensions?: string | null
          finish?: string | null
          grade?: string | null
          id: string
          itemId?: string | null
          materialFormId: string
          materialSubstanceId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          dimensions?: string | null
          finish?: string | null
          grade?: string | null
          id?: string
          itemId?: string | null
          materialFormId?: string
          materialSubstanceId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "material_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_materialFormId_fkey"
            columns: ["materialFormId"]
            isOneToOne: false
            referencedRelation: "materialForm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_materialSubstanceId_fkey"
            columns: ["materialSubstanceId"]
            isOneToOne: false
            referencedRelation: "materialSubstance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      materialForm: {
        Row: {
          companyId: string | null
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId?: string | null
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string | null
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materialForm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "materialForm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "materialForm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "materialForm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialForm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      materialSubstance: {
        Row: {
          companyId: string | null
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId?: string | null
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string | null
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materialSubstance_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "materialSubstance_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "materialSubstance_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "materialSubstance_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materialSubstance_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      membership: {
        Row: {
          groupId: string
          id: number
          memberGroupId: string | null
          memberUserId: string | null
        }
        Insert: {
          groupId: string
          id?: number
          memberGroupId?: string | null
          memberUserId?: string | null
        }
        Update: {
          groupId?: string
          id?: number
          memberGroupId?: string | null
          memberUserId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_groupId_fkey"
            columns: ["groupId"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberGroupId_fkey"
            columns: ["memberGroupId"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      methodMaterial: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string
          itemReadableId: string
          itemType: string
          makeMethodId: string
          materialMakeMethodId: string | null
          methodOperationId: string | null
          methodType: Database["public"]["Enums"]["methodType"]
          order: number
          productionQuantity: number | null
          quantity: number
          scrapQuantity: number
          unitOfMeasureCode: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          itemId: string
          itemReadableId: string
          itemType?: string
          makeMethodId: string
          materialMakeMethodId?: string | null
          methodOperationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          productionQuantity?: number | null
          quantity: number
          scrapQuantity?: number
          unitOfMeasureCode: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string
          itemReadableId?: string
          itemType?: string
          makeMethodId?: string
          materialMakeMethodId?: string | null
          methodOperationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          productionQuantity?: number | null
          quantity?: number
          scrapQuantity?: number
          unitOfMeasureCode?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "methodMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "methodMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "methodMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "methodMaterial_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_materialMakeMethodId_fkey"
            columns: ["materialMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodMaterial_materialMakeMethodId_fkey"
            columns: ["materialMakeMethodId"]
            isOneToOne: false
            referencedRelation: "makeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_materialMakeMethodId_fkey"
            columns: ["materialMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodMaterial_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodMaterial_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "makeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodMaterial_methodOperation_fkey"
            columns: ["methodOperationId"]
            isOneToOne: false
            referencedRelation: "methodOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "methodMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      methodOperation: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string
          id: string
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          makeMethodId: string
          operationOrder: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId: string | null
          operationType: Database["public"]["Enums"]["operationType"]
          order: number
          processId: string
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
          workInstruction: Json
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description: string
          id?: string
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          makeMethodId: string
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          order?: number
          processId: string
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string
          id?: string
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          makeMethodId?: string
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          order?: number
          processId?: string
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Relationships: [
          {
            foreignKeyName: "methodOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "methodOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "methodOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "methodOperation_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodOperation_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "makeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_methodId_fkey"
            columns: ["makeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteOperationsWithMakeMethods"
            referencedColumns: ["makeMethodId"]
          },
          {
            foreignKeyName: "methodOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "methodOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methodOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcess"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcesses"
            referencedColumns: ["id"]
          },
        ]
      }
      modelUpload: {
        Row: {
          autodeskUrn: string | null
          companyId: string
          createdAt: string | null
          createdBy: string
          id: string
          modelPath: string
          name: string | null
          size: number | null
          thumbnailPath: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          autodeskUrn?: string | null
          companyId: string
          createdAt?: string | null
          createdBy: string
          id?: string
          modelPath: string
          name?: string | null
          size?: number | null
          thumbnailPath?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          autodeskUrn?: string | null
          companyId?: string
          createdAt?: string | null
          createdBy?: string
          id?: string
          modelPath?: string
          name?: string | null
          size?: number | null
          thumbnailPath?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modelUpload_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "modelUpload_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "modelUpload_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "modelUpload_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelUpload_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      note: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          documentId: string
          id: string
          note: string
          noteRichText: Json
          updatedAt: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          documentId: string
          id?: string
          note: string
          noteRichText?: Json
          updatedAt?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          documentId?: string
          id?: string
          note?: string
          noteRichText?: Json
          updatedAt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "notes_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "notes_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      oauthClient: {
        Row: {
          clientId: string
          clientSecret: string
          companyId: string
          createdAt: string | null
          id: string
          name: string
          redirectUris: string[]
          updatedAt: string | null
        }
        Insert: {
          clientId: string
          clientSecret: string
          companyId: string
          createdAt?: string | null
          id?: string
          name: string
          redirectUris?: string[]
          updatedAt?: string | null
        }
        Update: {
          clientId?: string
          clientSecret?: string
          companyId?: string
          createdAt?: string | null
          id?: string
          name?: string
          redirectUris?: string[]
          updatedAt?: string | null
        }
        Relationships: []
      }
      oauthCode: {
        Row: {
          clientId: string
          code: string
          companyId: string
          createdAt: string | null
          expiresAt: string
          id: string
          redirectUri: string
          userId: string
        }
        Insert: {
          clientId: string
          code: string
          companyId: string
          createdAt?: string | null
          expiresAt: string
          id?: string
          redirectUri: string
          userId: string
        }
        Update: {
          clientId?: string
          code?: string
          companyId?: string
          createdAt?: string | null
          expiresAt?: string
          id?: string
          redirectUri?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauthCode_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "oauthClient"
            referencedColumns: ["clientId"]
          },
          {
            foreignKeyName: "oauthCode_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "oauthCode_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "oauthCode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthCode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      oauthToken: {
        Row: {
          accessToken: string
          clientId: string
          companyId: string
          createdAt: string | null
          expiresAt: string
          id: string
          refreshToken: string
          userId: string
        }
        Insert: {
          accessToken: string
          clientId: string
          companyId: string
          createdAt?: string | null
          expiresAt: string
          id?: string
          refreshToken: string
          userId: string
        }
        Update: {
          accessToken?: string
          clientId?: string
          companyId?: string
          createdAt?: string | null
          expiresAt?: string
          id?: string
          refreshToken?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauthToken_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "oauthClient"
            referencedColumns: ["clientId"]
          },
          {
            foreignKeyName: "oauthToken_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "oauthToken_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "oauthToken_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauthToken_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      opportunity: {
        Row: {
          companyId: string
          id: string
          purchaseOrderDocumentPath: string | null
          quoteId: string | null
          requestForQuoteDocumentPath: string | null
          salesOrderId: string | null
          salesRfqId: string | null
        }
        Insert: {
          companyId: string
          id?: string
          purchaseOrderDocumentPath?: string | null
          quoteId?: string | null
          requestForQuoteDocumentPath?: string | null
          salesOrderId?: string | null
          salesRfqId?: string | null
        }
        Update: {
          companyId?: string
          id?: string
          purchaseOrderDocumentPath?: string | null
          quoteId?: string | null
          requestForQuoteDocumentPath?: string | null
          salesOrderId?: string | null
          salesRfqId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "opportunity_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfq"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      part: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          fromDate: string | null
          id: string
          itemId: string
          toDate: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          fromDate?: string | null
          id: string
          itemId: string
          toDate?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          fromDate?: string | null
          id?: string
          itemId?: string
          toDate?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "part_id_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      partner: {
        Row: {
          abilityId: string
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          hoursPerWeek: number
          id: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          abilityId: string
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          hoursPerWeek?: number
          id: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          abilityId?: string
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          hoursPerWeek?: number
          id?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_abilityId_fkey"
            columns: ["abilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "partner_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      paymentTerm: {
        Row: {
          active: boolean
          calculationMethod: Database["public"]["Enums"]["paymentTermCalculationMethod"]
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          daysDiscount: number
          daysDue: number
          discountPercentage: number
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          calculationMethod?: Database["public"]["Enums"]["paymentTermCalculationMethod"]
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          daysDiscount?: number
          daysDue?: number
          discountPercentage?: number
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          calculationMethod?: Database["public"]["Enums"]["paymentTermCalculationMethod"]
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          daysDiscount?: number
          daysDue?: number
          discountPercentage?: number
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paymentTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "paymentTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "paymentTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "paymentTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paymentTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      pickMethod: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          defaultShelfId: string | null
          itemId: string
          locationId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          defaultShelfId?: string | null
          itemId: string
          locationId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          defaultShelfId?: string | null
          itemId?: string
          locationId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "pickMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "pickMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "pickMethod_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "pickMethod_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "pickMethod_shelfId_fkey"
            columns: ["defaultShelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      postingGroupInventory: {
        Row: {
          capacityVarianceAccount: string
          companyId: string
          costOfGoodsSoldAccount: string
          directCostAppliedAccount: string
          id: string
          inventoryAccount: string
          inventoryAdjustmentVarianceAccount: string
          inventoryInterimAccrualAccount: string
          inventoryInvoicedNotReceivedAccount: string
          inventoryReceivedNotInvoicedAccount: string
          inventoryShippedNotInvoicedAccount: string
          itemPostingGroupId: string | null
          locationId: string | null
          materialVarianceAccount: string
          overheadAccount: string
          overheadCostAppliedAccount: string
          purchaseVarianceAccount: string
          updatedBy: string | null
          workInProgressAccount: string
        }
        Insert: {
          capacityVarianceAccount: string
          companyId: string
          costOfGoodsSoldAccount: string
          directCostAppliedAccount: string
          id?: string
          inventoryAccount: string
          inventoryAdjustmentVarianceAccount: string
          inventoryInterimAccrualAccount: string
          inventoryInvoicedNotReceivedAccount: string
          inventoryReceivedNotInvoicedAccount: string
          inventoryShippedNotInvoicedAccount: string
          itemPostingGroupId?: string | null
          locationId?: string | null
          materialVarianceAccount: string
          overheadAccount: string
          overheadCostAppliedAccount: string
          purchaseVarianceAccount: string
          updatedBy?: string | null
          workInProgressAccount: string
        }
        Update: {
          capacityVarianceAccount?: string
          companyId?: string
          costOfGoodsSoldAccount?: string
          directCostAppliedAccount?: string
          id?: string
          inventoryAccount?: string
          inventoryAdjustmentVarianceAccount?: string
          inventoryInterimAccrualAccount?: string
          inventoryInvoicedNotReceivedAccount?: string
          inventoryReceivedNotInvoicedAccount?: string
          inventoryShippedNotInvoicedAccount?: string
          itemPostingGroupId?: string | null
          locationId?: string | null
          materialVarianceAccount?: string
          overheadAccount?: string
          overheadCostAppliedAccount?: string
          purchaseVarianceAccount?: string
          updatedBy?: string | null
          workInProgressAccount?: string
        }
        Relationships: [
          {
            foreignKeyName: "postingGroupInventory_capacityVarianceAccount_fkey"
            columns: ["capacityVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_capacityVarianceAccount_fkey"
            columns: ["capacityVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_costOfGoodsSoldAccount_fkey"
            columns: ["costOfGoodsSoldAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_costOfGoodsSoldAccount_fkey"
            columns: ["costOfGoodsSoldAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_directCostAppliedAccount_fkey"
            columns: ["directCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_directCostAppliedAccount_fkey"
            columns: ["directCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryAccount_fkey"
            columns: ["inventoryAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryAccount_fkey"
            columns: ["inventoryAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey"
            columns: ["inventoryAdjustmentVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey"
            columns: ["inventoryAdjustmentVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryInterimAccrualAccount_fkey"
            columns: ["inventoryInterimAccrualAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryInterimAccrualAccount_fkey"
            columns: ["inventoryInterimAccrualAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey"
            columns: ["inventoryInvoicedNotReceivedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey"
            columns: ["inventoryInvoicedNotReceivedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey"
            columns: ["inventoryReceivedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey"
            columns: ["inventoryReceivedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey"
            columns: ["inventoryShippedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey"
            columns: ["inventoryShippedNotInvoicedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_itemPostingGroupId_fkey"
            columns: ["itemPostingGroupId"]
            isOneToOne: false
            referencedRelation: "itemPostingGroup"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "postingGroupInventory_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "postingGroupInventory_materialVarianceAccount_fkey"
            columns: ["materialVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_materialVarianceAccount_fkey"
            columns: ["materialVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_overheadAccount_fkey"
            columns: ["overheadAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_overheadAccount_fkey"
            columns: ["overheadAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_overheadCostAppliedAccount_fkey"
            columns: ["overheadCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_overheadCostAppliedAccount_fkey"
            columns: ["overheadCostAppliedAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_purchaseVarianceAccount_fkey"
            columns: ["purchaseVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_purchaseVarianceAccount_fkey"
            columns: ["purchaseVarianceAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupInventory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "postingGroupInventory_workInProgressAccount_fkey"
            columns: ["workInProgressAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupInventory_workInProgressAccount_fkey"
            columns: ["workInProgressAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
        ]
      }
      postingGroupPurchasing: {
        Row: {
          companyId: string
          id: string
          itemPostingGroupId: string | null
          payablesAccount: string
          purchaseAccount: string
          purchaseCreditAccount: string
          purchaseDiscountAccount: string
          purchasePrepaymentAccount: string
          purchaseTaxPayableAccount: string
          supplierTypeId: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          id?: string
          itemPostingGroupId?: string | null
          payablesAccount: string
          purchaseAccount: string
          purchaseCreditAccount: string
          purchaseDiscountAccount: string
          purchasePrepaymentAccount: string
          purchaseTaxPayableAccount: string
          supplierTypeId?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          id?: string
          itemPostingGroupId?: string | null
          payablesAccount?: string
          purchaseAccount?: string
          purchaseCreditAccount?: string
          purchaseDiscountAccount?: string
          purchasePrepaymentAccount?: string
          purchaseTaxPayableAccount?: string
          supplierTypeId?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postingGroupPurchasing_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_itemPostingGroupId_fkey"
            columns: ["itemPostingGroupId"]
            isOneToOne: false
            referencedRelation: "itemPostingGroup"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_payablesAccount_fkey"
            columns: ["payablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_payablesAccount_fkey"
            columns: ["payablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseAccount_fkey"
            columns: ["purchaseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseAccount_fkey"
            columns: ["purchaseAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseCreditAccount_fkey"
            columns: ["purchaseCreditAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseCreditAccount_fkey"
            columns: ["purchaseCreditAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseDiscountAccount_fkey"
            columns: ["purchaseDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseDiscountAccount_fkey"
            columns: ["purchaseDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchasePrepaymentAccount_fkey"
            columns: ["purchasePrepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchasePrepaymentAccount_fkey"
            columns: ["purchasePrepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseTaxPayableAccount_fkey"
            columns: ["purchaseTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_purchaseTaxPayableAccount_fkey"
            columns: ["purchaseTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_supplierTypeId_fkey"
            columns: ["supplierTypeId"]
            isOneToOne: false
            referencedRelation: "supplierType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupPurchasing_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      postingGroupSales: {
        Row: {
          companyId: string
          customerTypeId: string | null
          id: string
          itemPostingGroupId: string | null
          receivablesAccount: string
          salesAccount: string
          salesCreditAccount: string
          salesDiscountAccount: string
          salesPrepaymentAccount: string
          salesTaxPayableAccount: string
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          customerTypeId?: string | null
          id?: string
          itemPostingGroupId?: string | null
          receivablesAccount: string
          salesAccount: string
          salesCreditAccount: string
          salesDiscountAccount: string
          salesPrepaymentAccount: string
          salesTaxPayableAccount: string
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          customerTypeId?: string | null
          id?: string
          itemPostingGroupId?: string | null
          receivablesAccount?: string
          salesAccount?: string
          salesCreditAccount?: string
          salesDiscountAccount?: string
          salesPrepaymentAccount?: string
          salesTaxPayableAccount?: string
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postingGroupSales_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_customerTypeId_fkey"
            columns: ["customerTypeId"]
            isOneToOne: false
            referencedRelation: "customerType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_itemPostingGroupId_fkey"
            columns: ["itemPostingGroupId"]
            isOneToOne: false
            referencedRelation: "itemPostingGroup"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_receivablesAccount_fkey"
            columns: ["receivablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_receivablesAccount_fkey"
            columns: ["receivablesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesAccount_fkey"
            columns: ["salesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesAccount_fkey"
            columns: ["salesAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesCreditAccount_fkey"
            columns: ["salesCreditAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesCreditAccount_fkey"
            columns: ["salesCreditAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesDiscountAccount_fkey"
            columns: ["salesDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesDiscountAccount_fkey"
            columns: ["salesDiscountAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesPrepaymentAccount_fkey"
            columns: ["salesPrepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesPrepaymentAccount_fkey"
            columns: ["salesPrepaymentAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesTaxPayableAccount_fkey"
            columns: ["salesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_salesTaxPayableAccount_fkey"
            columns: ["salesTaxPayableAccount", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "postingGroupSales_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postingGroupSales_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      process: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          defaultStandardFactor: Database["public"]["Enums"]["factor"]
          id: string
          name: string
          processType: Database["public"]["Enums"]["processType"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          defaultStandardFactor: Database["public"]["Enums"]["factor"]
          id?: string
          name: string
          processType?: Database["public"]["Enums"]["processType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          defaultStandardFactor?: Database["public"]["Enums"]["factor"]
          id?: string
          name?: string
          processType?: Database["public"]["Enums"]["processType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      productionEvent: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          duration: number | null
          employeeId: string | null
          endTime: string | null
          id: string
          jobOperationId: string
          startTime: string
          type: Database["public"]["Enums"]["productionEventType"] | null
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          duration?: number | null
          employeeId?: string | null
          endTime?: string | null
          id?: string
          jobOperationId: string
          startTime?: string
          type?: Database["public"]["Enums"]["productionEventType"] | null
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          duration?: number | null
          employeeId?: string | null
          endTime?: string | null
          id?: string
          jobOperationId?: string
          startTime?: string
          type?: Database["public"]["Enums"]["productionEventType"] | null
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productionEvent_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "productionEvent_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "productionEvent_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "productionEvent_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "productionEvent_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "productionEvent_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productionEvent_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseInvoice: {
        Row: {
          assignee: string | null
          balance: number
          companyId: string
          createdAt: string
          createdBy: string
          currencyCode: string
          customFields: Json | null
          dateDue: string | null
          dateIssued: string | null
          datePaid: string | null
          exchangeRate: number
          id: string
          invoiceId: string
          invoiceSupplierContactId: string | null
          invoiceSupplierId: string | null
          invoiceSupplierLocationId: string | null
          paymentTermId: string | null
          postingDate: string | null
          status: Database["public"]["Enums"]["purchaseInvoiceStatus"]
          subtotal: number
          supplierId: string | null
          supplierReference: string | null
          totalAmount: number
          totalDiscount: number
          totalTax: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          balance?: number
          companyId: string
          createdAt?: string
          createdBy: string
          currencyCode: string
          customFields?: Json | null
          dateDue?: string | null
          dateIssued?: string | null
          datePaid?: string | null
          exchangeRate?: number
          id?: string
          invoiceId: string
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentTermId?: string | null
          postingDate?: string | null
          status?: Database["public"]["Enums"]["purchaseInvoiceStatus"]
          subtotal?: number
          supplierId?: string | null
          supplierReference?: string | null
          totalAmount?: number
          totalDiscount?: number
          totalTax?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          balance?: number
          companyId?: string
          createdAt?: string
          createdBy?: string
          currencyCode?: string
          customFields?: Json | null
          dateDue?: string | null
          dateIssued?: string | null
          datePaid?: string | null
          exchangeRate?: number
          id?: string
          invoiceId?: string
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentTermId?: string | null
          postingDate?: string | null
          status?: Database["public"]["Enums"]["purchaseInvoiceStatus"]
          subtotal?: number
          supplierId?: string | null
          supplierReference?: string | null
          totalAmount?: number
          totalDiscount?: number
          totalTax?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseInvoice_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierContactId_fkey"
            columns: ["invoiceSupplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierLocationId_fkey"
            columns: ["invoiceSupplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseInvoiceLine: {
        Row: {
          accountNumber: string | null
          assetId: string | null
          companyId: string
          conversionFactor: number | null
          createdAt: string
          createdBy: string
          currencyCode: string
          customFields: Json | null
          description: string | null
          exchangeRate: number
          id: string
          inventoryUnitOfMeasureCode: string | null
          invoiceId: string
          invoiceLineType: Database["public"]["Enums"]["payableLineType"]
          itemId: string | null
          itemReadableId: string | null
          locationId: string | null
          purchaseOrderId: string | null
          purchaseOrderLineId: string | null
          purchaseUnitOfMeasureCode: string | null
          quantity: number
          serviceId: string | null
          shelfId: string | null
          totalAmount: number | null
          unitPrice: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountNumber?: string | null
          assetId?: string | null
          companyId: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy: string
          currencyCode: string
          customFields?: Json | null
          description?: string | null
          exchangeRate?: number
          id?: string
          inventoryUnitOfMeasureCode?: string | null
          invoiceId: string
          invoiceLineType: Database["public"]["Enums"]["payableLineType"]
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          purchaseOrderId?: string | null
          purchaseOrderLineId?: string | null
          purchaseUnitOfMeasureCode?: string | null
          quantity?: number
          serviceId?: string | null
          shelfId?: string | null
          totalAmount?: number | null
          unitPrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountNumber?: string | null
          assetId?: string | null
          companyId?: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy?: string
          currencyCode?: string
          customFields?: Json | null
          description?: string | null
          exchangeRate?: number
          id?: string
          inventoryUnitOfMeasureCode?: string | null
          invoiceId?: string
          invoiceLineType?: Database["public"]["Enums"]["payableLineType"]
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          purchaseOrderId?: string | null
          purchaseOrderLineId?: string | null
          purchaseUnitOfMeasureCode?: string | null
          quantity?: number
          serviceId?: string | null
          shelfId?: string | null
          totalAmount?: number | null
          unitPrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseInvoiceLines_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_inventoryUnitOfMeasureCode_fkey"
            columns: ["inventoryUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseOrderLineId_fkey"
            columns: ["purchaseOrderLineId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseOrderLineId_fkey"
            columns: ["purchaseOrderLineId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_purchaseUnitOfMeasureCode_fkey"
            columns: ["purchaseUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceLines_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseInvoicePaymentRelation: {
        Row: {
          id: string
          invoiceId: string
          paymentId: string
        }
        Insert: {
          id?: string
          invoiceId: string
          paymentId: string
        }
        Update: {
          id?: string
          invoiceId?: string
          paymentId?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchasePayments_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayments_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayments_paymentId_fkey"
            columns: ["paymentId"]
            isOneToOne: false
            referencedRelation: "purchasePayment"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseInvoicePriceChange: {
        Row: {
          id: string
          invoiceId: string
          invoiceLineId: string
          newPrice: number
          newQuantity: number
          previousPrice: number
          previousQuantity: number
          updatedBy: string
        }
        Insert: {
          id?: string
          invoiceId: string
          invoiceLineId: string
          newPrice?: number
          newQuantity?: number
          previousPrice?: number
          previousQuantity?: number
          updatedBy: string
        }
        Update: {
          id?: string
          invoiceId?: string
          invoiceLineId?: string
          newPrice?: number
          newQuantity?: number
          previousPrice?: number
          previousQuantity?: number
          updatedBy?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchaseInvoicePriceChange_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_invoiceLineId_fkey"
            columns: ["invoiceLineId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoiceLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoicePriceChange_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseInvoiceStatusHistory: {
        Row: {
          createdAt: string
          id: string
          invoiceId: string
          status: Database["public"]["Enums"]["purchaseInvoiceStatus"]
        }
        Insert: {
          createdAt?: string
          id?: string
          invoiceId: string
          status: Database["public"]["Enums"]["purchaseInvoiceStatus"]
        }
        Update: {
          createdAt?: string
          id?: string
          invoiceId?: string
          status?: Database["public"]["Enums"]["purchaseInvoiceStatus"]
        }
        Relationships: [
          {
            foreignKeyName: "purchaseInvoiceStatusHistory_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoiceStatusHistory_invoiceId_fkey"
            columns: ["invoiceId"]
            isOneToOne: false
            referencedRelation: "purchaseInvoices"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseOrder: {
        Row: {
          assignee: string | null
          closedAt: string | null
          closedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          notes: string | null
          orderDate: string
          purchaseOrderId: string
          revisionId: number
          status: Database["public"]["Enums"]["purchaseOrderStatus"]
          supplierContactId: string | null
          supplierId: string
          supplierLocationId: string | null
          supplierReference: string | null
          type: Database["public"]["Enums"]["purchaseOrderType"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          closedAt?: string | null
          closedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          notes?: string | null
          orderDate?: string
          purchaseOrderId: string
          revisionId?: number
          status?: Database["public"]["Enums"]["purchaseOrderStatus"]
          supplierContactId?: string | null
          supplierId: string
          supplierLocationId?: string | null
          supplierReference?: string | null
          type: Database["public"]["Enums"]["purchaseOrderType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          closedAt?: string | null
          closedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          notes?: string | null
          orderDate?: string
          purchaseOrderId?: string
          revisionId?: number
          status?: Database["public"]["Enums"]["purchaseOrderStatus"]
          supplierContactId?: string | null
          supplierId?: string
          supplierLocationId?: string | null
          supplierReference?: string | null
          type?: Database["public"]["Enums"]["purchaseOrderType"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierContactId_fkey"
            columns: ["supplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierLocationId_fkey"
            columns: ["supplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderDelivery: {
        Row: {
          companyId: string
          customerId: string | null
          customerLocationId: string | null
          customFields: Json | null
          deliveryDate: string | null
          dropShipment: boolean
          id: string
          locationId: string | null
          notes: string | null
          receiptPromisedDate: string | null
          receiptRequestedDate: string | null
          shippingMethodId: string | null
          shippingTermId: string | null
          trackingNumber: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          customerId?: string | null
          customerLocationId?: string | null
          customFields?: Json | null
          deliveryDate?: string | null
          dropShipment?: boolean
          id: string
          locationId?: string | null
          notes?: string | null
          receiptPromisedDate?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          trackingNumber?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          customerId?: string | null
          customerLocationId?: string | null
          customFields?: Json | null
          deliveryDate?: string | null
          dropShipment?: boolean
          id?: string
          locationId?: string | null
          notes?: string | null
          receiptPromisedDate?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          trackingNumber?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderDelivery_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_shippingMethodId_fkey"
            columns: ["shippingMethodId"]
            isOneToOne: false
            referencedRelation: "shippingMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_shippingTermId_fkey"
            columns: ["shippingTermId"]
            isOneToOne: false
            referencedRelation: "shippingTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderDelivery_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderFavorite: {
        Row: {
          purchaseOrderId: string
          userId: string
        }
        Insert: {
          purchaseOrderId: string
          userId: string
        }
        Update: {
          purchaseOrderId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderFavorites_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderLine: {
        Row: {
          accountNumber: string | null
          assetId: string | null
          companyId: string
          conversionFactor: number | null
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string | null
          id: string
          inventoryUnitOfMeasureCode: string | null
          invoicedComplete: boolean
          itemId: string | null
          itemReadableId: string | null
          locationId: string | null
          purchaseOrderId: string
          purchaseOrderLineType: Database["public"]["Enums"]["purchaseOrderLineType"]
          purchaseQuantity: number | null
          purchaseUnitOfMeasureCode: string | null
          quantityInvoiced: number | null
          quantityReceived: number | null
          quantityToInvoice: number | null
          quantityToReceive: number | null
          receivedComplete: boolean
          requiresInspection: boolean
          setupPrice: number | null
          shelfId: string | null
          unitPrice: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountNumber?: string | null
          assetId?: string | null
          companyId: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description?: string | null
          id?: string
          inventoryUnitOfMeasureCode?: string | null
          invoicedComplete?: boolean
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          purchaseOrderId: string
          purchaseOrderLineType: Database["public"]["Enums"]["purchaseOrderLineType"]
          purchaseQuantity?: number | null
          purchaseUnitOfMeasureCode?: string | null
          quantityInvoiced?: number | null
          quantityReceived?: number | null
          quantityToInvoice?: number | null
          quantityToReceive?: number | null
          receivedComplete?: boolean
          requiresInspection?: boolean
          setupPrice?: number | null
          shelfId?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountNumber?: string | null
          assetId?: string | null
          companyId?: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string | null
          id?: string
          inventoryUnitOfMeasureCode?: string | null
          invoicedComplete?: boolean
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          purchaseOrderId?: string
          purchaseOrderLineType?: Database["public"]["Enums"]["purchaseOrderLineType"]
          purchaseQuantity?: number | null
          purchaseUnitOfMeasureCode?: string | null
          quantityInvoiced?: number | null
          quantityReceived?: number | null
          quantityToInvoice?: number | null
          quantityToReceive?: number | null
          receivedComplete?: boolean
          requiresInspection?: boolean
          setupPrice?: number | null
          shelfId?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_inventoryUnitOfMeasureCode_fkey"
            columns: ["inventoryUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseUnitOfMeasureCode_fkey"
            columns: ["purchaseUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderPayment: {
        Row: {
          companyId: string
          currencyCode: string
          customFields: Json | null
          id: string
          invoiceSupplierContactId: string | null
          invoiceSupplierId: string | null
          invoiceSupplierLocationId: string | null
          paymentComplete: boolean
          paymentTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          currencyCode?: string
          customFields?: Json | null
          id: string
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentComplete?: boolean
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          currencyCode?: string
          customFields?: Json | null
          id?: string
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentComplete?: boolean
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderPayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierContactId_fkey"
            columns: ["invoiceSupplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_invoiceSupplierLocationId_fkey"
            columns: ["invoiceSupplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderPayment_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseOrderStatusHistory: {
        Row: {
          createdAt: string
          createdBy: string
          id: string
          purchaseOrderId: string
          status: Database["public"]["Enums"]["purchaseOrderStatus"]
        }
        Insert: {
          createdAt?: string
          createdBy: string
          id?: string
          purchaseOrderId: string
          status: Database["public"]["Enums"]["purchaseOrderStatus"]
        }
        Update: {
          createdAt?: string
          createdBy?: string
          id?: string
          purchaseOrderId?: string
          status?: Database["public"]["Enums"]["purchaseOrderStatus"]
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderStatusHistory_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseOrderTransaction: {
        Row: {
          createdAt: string
          id: string
          purchaseOrderId: string
          type: Database["public"]["Enums"]["purchaseOrderTransactionType"]
          userId: string
        }
        Insert: {
          createdAt?: string
          id?: string
          purchaseOrderId: string
          type: Database["public"]["Enums"]["purchaseOrderTransactionType"]
          userId: string
        }
        Update: {
          createdAt?: string
          id?: string
          purchaseOrderId?: string
          type?: Database["public"]["Enums"]["purchaseOrderTransactionType"]
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrderTransaction_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchasePayment: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          currencyCode: string
          customFields: Json | null
          exchangeRate: number
          id: string
          paymentDate: string | null
          paymentId: string
          supplierId: string
          totalAmount: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          currencyCode: string
          customFields?: Json | null
          exchangeRate?: number
          id?: string
          paymentDate?: string | null
          paymentId: string
          supplierId: string
          totalAmount?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          currencyCode?: string
          customFields?: Json | null
          exchangeRate?: number
          id?: string
          paymentDate?: string | null
          paymentId?: string
          supplierId?: string
          totalAmount?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchasePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchasePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchasePayment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchasePayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchasePayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchasePayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchasePayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchasePayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quote: {
        Row: {
          assignee: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customerContactId: string | null
          customerId: string
          customerLocationId: string | null
          customerReference: string | null
          customFields: Json | null
          dueDate: string | null
          estimatorId: string | null
          expirationDate: string | null
          externalNotes: Json | null
          id: string
          internalNotes: Json | null
          locationId: string | null
          quoteId: string
          revisionId: number
          salesPersonId: string | null
          status: Database["public"]["Enums"]["quoteStatus"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customerContactId?: string | null
          customerId: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          dueDate?: string | null
          estimatorId?: string | null
          expirationDate?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          locationId?: string | null
          quoteId: string
          revisionId?: number
          salesPersonId?: string | null
          status?: Database["public"]["Enums"]["quoteStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customerContactId?: string | null
          customerId?: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          dueDate?: string | null
          estimatorId?: string | null
          expirationDate?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          locationId?: string | null
          quoteId?: string
          revisionId?: number
          salesPersonId?: string | null
          status?: Database["public"]["Enums"]["quoteStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteFavorite: {
        Row: {
          quoteId: string
          userId: string
        }
        Insert: {
          quoteId: string
          userId: string
        }
        Update: {
          quoteId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "quoteFavorites_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteFavorites_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteLine: {
        Row: {
          additionalCharges: Json | null
          companyId: string
          createdBy: string
          customerPartId: string | null
          customerPartRevision: string | null
          customFields: Json | null
          description: string
          estimatorId: string | null
          id: string
          itemId: string
          itemReadableId: string | null
          itemType: string
          locationId: string | null
          methodType: Database["public"]["Enums"]["methodType"]
          modelUploadId: string | null
          noQuoteReason: string | null
          notes: Json | null
          quantity: number[] | null
          quoteId: string
          quoteRevisionId: number
          status: Database["public"]["Enums"]["quoteLineStatus"]
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          additionalCharges?: Json | null
          companyId: string
          createdBy: string
          customerPartId?: string | null
          customerPartRevision?: string | null
          customFields?: Json | null
          description: string
          estimatorId?: string | null
          id?: string
          itemId: string
          itemReadableId?: string | null
          itemType?: string
          locationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          modelUploadId?: string | null
          noQuoteReason?: string | null
          notes?: Json | null
          quantity?: number[] | null
          quoteId: string
          quoteRevisionId?: number
          status?: Database["public"]["Enums"]["quoteLineStatus"]
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          additionalCharges?: Json | null
          companyId?: string
          createdBy?: string
          customerPartId?: string | null
          customerPartRevision?: string | null
          customFields?: Json | null
          description?: string
          estimatorId?: string | null
          id?: string
          itemId?: string
          itemReadableId?: string | null
          itemType?: string
          locationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          modelUploadId?: string | null
          noQuoteReason?: string | null
          notes?: Json | null
          quantity?: number[] | null
          quoteId?: string
          quoteRevisionId?: number
          status?: Database["public"]["Enums"]["quoteLineStatus"]
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteLinePrice: {
        Row: {
          createdAt: string
          createdBy: string
          discountPercent: number
          leadTime: number
          quantity: number
          quoteId: string
          quoteLineId: string
          unitPrice: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          createdAt?: string
          createdBy: string
          discountPercent?: number
          leadTime?: number
          quantity?: number
          quoteId: string
          quoteLineId: string
          unitPrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          createdAt?: string
          createdBy?: string
          discountPercent?: number
          leadTime?: number
          quantity?: number
          quoteId?: string
          quoteLineId?: string
          unitPrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteLinePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteLinePrice_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteLinePrice_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLinePrice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteMakeMethod: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string
          parentMaterialId: string | null
          quantityPerParent: number
          quoteId: string
          quoteLineId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          itemId: string
          parentMaterialId?: string | null
          quantityPerParent?: number
          quoteId: string
          quoteLineId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string
          parentMaterialId?: string | null
          quantityPerParent?: number
          quoteId?: string
          quoteLineId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMakeMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteMakeMethod_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_parentMaterialId_fkey"
            columns: ["parentMaterialId"]
            isOneToOne: false
            referencedRelation: "quoteMaterial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_parentMaterialId_fkey"
            columns: ["parentMaterialId"]
            isOneToOne: false
            referencedRelation: "quoteMaterialWithMakeMethodId"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteMakeMethod_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMakeMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteMaterial: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string
          id: string
          itemId: string
          itemReadableId: string
          itemType: string
          methodType: Database["public"]["Enums"]["methodType"]
          order: number
          productionQuantity: number | null
          quantity: number
          quoteId: string
          quoteLineId: string
          quoteMakeMethodId: string
          quoteOperationId: string | null
          scrapQuantity: number
          unitCost: number
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description: string
          id?: string
          itemId: string
          itemReadableId: string
          itemType?: string
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          productionQuantity?: number | null
          quantity?: number
          quoteId: string
          quoteLineId: string
          quoteMakeMethodId: string
          quoteOperationId?: string | null
          scrapQuantity?: number
          unitCost?: number
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string
          id?: string
          itemId?: string
          itemReadableId?: string
          itemType?: string
          methodType?: Database["public"]["Enums"]["methodType"]
          order?: number
          productionQuantity?: number | null
          quantity?: number
          quoteId?: string
          quoteLineId?: string
          quoteMakeMethodId?: string
          quoteOperationId?: string | null
          scrapQuantity?: number
          unitCost?: number
          unitOfMeasureCode?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteMaterial_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMaterialWithMakeMethodId"
            referencedColumns: ["quoteMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteOperationId_fkey"
            columns: ["quoteOperationId"]
            isOneToOne: false
            referencedRelation: "quoteOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteOperationId_fkey"
            columns: ["quoteOperationId"]
            isOneToOne: false
            referencedRelation: "quoteOperationsWithMakeMethods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteOperation: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string | null
          id: string
          laborRate: number
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineRate: number | null
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationLeadTime: number
          operationMinimumCost: number
          operationOrder: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId: string | null
          operationType: Database["public"]["Enums"]["operationType"]
          operationUnitCost: number
          order: number
          overheadRate: number
          processId: string
          quoteId: string
          quoteLineId: string
          quoteMakeMethodId: string | null
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
          workInstruction: Json
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description?: string | null
          id?: string
          laborRate?: number
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineRate?: number | null
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          operationLeadTime?: number
          operationMinimumCost?: number
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          operationUnitCost?: number
          order?: number
          overheadRate?: number
          processId: string
          quoteId: string
          quoteLineId: string
          quoteMakeMethodId?: string | null
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string | null
          id?: string
          laborRate?: number
          laborTime?: number
          laborUnit?: Database["public"]["Enums"]["factor"]
          machineRate?: number | null
          machineTime?: number
          machineUnit?: Database["public"]["Enums"]["factor"]
          operationLeadTime?: number
          operationMinimumCost?: number
          operationOrder?: Database["public"]["Enums"]["methodOperationOrder"]
          operationSupplierProcessId?: string | null
          operationType?: Database["public"]["Enums"]["operationType"]
          operationUnitCost?: number
          order?: number
          overheadRate?: number
          processId?: string
          quoteId?: string
          quoteLineId?: string
          quoteMakeMethodId?: string | null
          setupTime?: number
          setupUnit?: Database["public"]["Enums"]["factor"]
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string | null
          workInstruction?: Json
        }
        Relationships: [
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcess"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMaterialWithMakeMethodId"
            referencedColumns: ["quoteMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
      quotePayment: {
        Row: {
          companyId: string
          currencyCode: string
          customFields: Json | null
          id: string
          invoiceCustomerContactId: string | null
          invoiceCustomerId: string | null
          invoiceCustomerLocationId: string | null
          paymentTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          currencyCode?: string
          customFields?: Json | null
          id: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          currencyCode?: string
          customFields?: Json | null
          id?: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quotePayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quotePayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "quotePayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quotePayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_invoiceCustomerContactId_fkey"
            columns: ["invoiceCustomerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_invoiceCustomerLocationId_fkey"
            columns: ["invoiceCustomerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotePayment_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
        ]
      }
      quoteShipment: {
        Row: {
          companyId: string
          id: string
          locationId: string | null
          receiptRequestedDate: string | null
          shippingMethodId: string | null
          shippingTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          id: string
          locationId?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          id?: string
          locationId?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteShipment_shippingMethodId_fkey"
            columns: ["shippingMethodId"]
            isOneToOne: false
            referencedRelation: "shippingMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_shippingTermId_fkey"
            columns: ["shippingTermId"]
            isOneToOne: false
            referencedRelation: "shippingTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      receipt: {
        Row: {
          assignee: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          externalDocumentId: string | null
          id: string
          invoiced: boolean | null
          locationId: string | null
          postingDate: string | null
          receiptId: string
          sourceDocument:
            | Database["public"]["Enums"]["receiptSourceDocument"]
            | null
          sourceDocumentId: string | null
          sourceDocumentReadableId: string | null
          status: Database["public"]["Enums"]["receiptStatus"]
          supplierId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          externalDocumentId?: string | null
          id?: string
          invoiced?: boolean | null
          locationId?: string | null
          postingDate?: string | null
          receiptId: string
          sourceDocument?:
            | Database["public"]["Enums"]["receiptSourceDocument"]
            | null
          sourceDocumentId?: string | null
          sourceDocumentReadableId?: string | null
          status?: Database["public"]["Enums"]["receiptStatus"]
          supplierId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          externalDocumentId?: string | null
          id?: string
          invoiced?: boolean | null
          locationId?: string | null
          postingDate?: string | null
          receiptId?: string
          sourceDocument?:
            | Database["public"]["Enums"]["receiptSourceDocument"]
            | null
          sourceDocumentId?: string | null
          sourceDocumentReadableId?: string | null
          status?: Database["public"]["Enums"]["receiptStatus"]
          supplierId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      receiptLine: {
        Row: {
          companyId: string
          conversionFactor: number | null
          createdAt: string
          createdBy: string
          id: string
          itemId: string
          itemReadableId: string | null
          lineId: string | null
          locationId: string | null
          orderQuantity: number
          outstandingQuantity: number
          receiptId: string
          receivedQuantity: number
          shelfId: string | null
          unitOfMeasure: string
          unitPrice: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy: string
          id?: string
          itemId: string
          itemReadableId?: string | null
          lineId?: string | null
          locationId?: string | null
          orderQuantity: number
          outstandingQuantity?: number
          receiptId: string
          receivedQuantity?: number
          shelfId?: string | null
          unitOfMeasure: string
          unitPrice: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          conversionFactor?: number | null
          createdAt?: string
          createdBy?: string
          id?: string
          itemId?: string
          itemReadableId?: string | null
          lineId?: string | null
          locationId?: string | null
          orderQuantity?: number
          outstandingQuantity?: number
          receiptId?: string
          receivedQuantity?: number
          shelfId?: string | null
          unitOfMeasure?: string
          unitPrice?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receiptLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "receiptLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receiptLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receiptLine_receiptId_fkey"
            columns: ["receiptId"]
            isOneToOne: false
            referencedRelation: "receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_receiptId_fkey"
            columns: ["receiptId"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiptLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrder: {
        Row: {
          assignee: string | null
          closedAt: string | null
          closedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          currencyCode: string
          customerContactId: string | null
          customerId: string
          customerLocationId: string | null
          customerReference: string | null
          customFields: Json | null
          id: string
          locationId: string | null
          notes: string | null
          orderDate: string
          revisionId: number
          salesOrderId: string
          status: Database["public"]["Enums"]["salesOrderStatus"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          closedAt?: string | null
          closedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          currencyCode?: string
          customerContactId?: string | null
          customerId: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          id?: string
          locationId?: string | null
          notes?: string | null
          orderDate?: string
          revisionId?: number
          salesOrderId: string
          status?: Database["public"]["Enums"]["salesOrderStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          closedAt?: string | null
          closedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          currencyCode?: string
          customerContactId?: string | null
          customerId?: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          id?: string
          locationId?: string | null
          notes?: string | null
          orderDate?: string
          revisionId?: number
          salesOrderId?: string
          status?: Database["public"]["Enums"]["salesOrderStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesOrder_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesOrder_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderFavorite: {
        Row: {
          salesOrderId: string
          userId: string
        }
        Insert: {
          salesOrderId: string
          userId: string
        }
        Update: {
          salesOrderId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderFavorites_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderLine: {
        Row: {
          accountNumber: string | null
          addOnCost: number
          assetId: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          description: string | null
          id: string
          invoicedComplete: boolean
          itemId: string | null
          itemReadableId: string | null
          locationId: string | null
          methodType: Database["public"]["Enums"]["methodType"]
          modelUploadId: string | null
          promisedDate: string | null
          quantityInvoiced: number | null
          quantitySent: number | null
          quantityToInvoice: number | null
          quantityToSend: number | null
          requiresInspection: boolean
          saleQuantity: number | null
          salesOrderId: string
          salesOrderLineType: Database["public"]["Enums"]["salesOrderLineType"]
          sentComplete: boolean
          setupPrice: number | null
          shelfId: string | null
          status: Database["public"]["Enums"]["salesOrderLineStatus"]
          unitOfMeasureCode: string | null
          unitPrice: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountNumber?: string | null
          addOnCost?: number
          assetId?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          description?: string | null
          id?: string
          invoicedComplete?: boolean
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          modelUploadId?: string | null
          promisedDate?: string | null
          quantityInvoiced?: number | null
          quantitySent?: number | null
          quantityToInvoice?: number | null
          quantityToSend?: number | null
          requiresInspection?: boolean
          saleQuantity?: number | null
          salesOrderId: string
          salesOrderLineType: Database["public"]["Enums"]["salesOrderLineType"]
          sentComplete?: boolean
          setupPrice?: number | null
          shelfId?: string | null
          status?: Database["public"]["Enums"]["salesOrderLineStatus"]
          unitOfMeasureCode?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountNumber?: string | null
          addOnCost?: number
          assetId?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          description?: string | null
          id?: string
          invoicedComplete?: boolean
          itemId?: string | null
          itemReadableId?: string | null
          locationId?: string | null
          methodType?: Database["public"]["Enums"]["methodType"]
          modelUploadId?: string | null
          promisedDate?: string | null
          quantityInvoiced?: number | null
          quantitySent?: number | null
          quantityToInvoice?: number | null
          quantityToSend?: number | null
          requiresInspection?: boolean
          saleQuantity?: number | null
          salesOrderId?: string
          salesOrderLineType?: Database["public"]["Enums"]["salesOrderLineType"]
          sentComplete?: boolean
          setupPrice?: number | null
          shelfId?: string | null
          status?: Database["public"]["Enums"]["salesOrderLineStatus"]
          unitOfMeasureCode?: string | null
          unitPrice?: number | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrderLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderPayment: {
        Row: {
          companyId: string
          currencyCode: string
          customFields: Json | null
          id: string
          invoiceCustomerContactId: string | null
          invoiceCustomerId: string | null
          invoiceCustomerLocationId: string | null
          paymentComplete: boolean
          paymentTermId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          currencyCode?: string
          customFields?: Json | null
          id: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentComplete?: boolean
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          currencyCode?: string
          customFields?: Json | null
          id?: string
          invoiceCustomerContactId?: string | null
          invoiceCustomerId?: string | null
          invoiceCustomerLocationId?: string | null
          paymentComplete?: boolean
          paymentTermId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrderPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrderPayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_invoiceCustomerContactId_fkey"
            columns: ["invoiceCustomerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_invoiceCustomerId_fkey"
            columns: ["invoiceCustomerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_invoiceCustomerLocationId_fkey"
            columns: ["invoiceCustomerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderPayment_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
        ]
      }
      salesOrderShipment: {
        Row: {
          assignee: string | null
          companyId: string
          customerId: string | null
          customerLocationId: string | null
          customFields: Json | null
          deliveryDate: string | null
          dropShipment: boolean
          id: string
          locationId: string | null
          notes: string | null
          receiptPromisedDate: string | null
          receiptRequestedDate: string | null
          shippingMethodId: string | null
          shippingTermId: string | null
          supplierId: string | null
          supplierLocationId: string | null
          trackingNumber: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          companyId: string
          customerId?: string | null
          customerLocationId?: string | null
          customFields?: Json | null
          deliveryDate?: string | null
          dropShipment?: boolean
          id: string
          locationId?: string | null
          notes?: string | null
          receiptPromisedDate?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          supplierId?: string | null
          supplierLocationId?: string | null
          trackingNumber?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          companyId?: string
          customerId?: string | null
          customerLocationId?: string | null
          customFields?: Json | null
          deliveryDate?: string | null
          dropShipment?: boolean
          id?: string
          locationId?: string | null
          notes?: string | null
          receiptPromisedDate?: string | null
          receiptRequestedDate?: string | null
          shippingMethodId?: string | null
          shippingTermId?: string | null
          supplierId?: string | null
          supplierLocationId?: string | null
          trackingNumber?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderShipment_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrderShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrderShipment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrderShipment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesOrderShipment_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesOrderShipment_shippingMethodId_fkey"
            columns: ["shippingMethodId"]
            isOneToOne: false
            referencedRelation: "shippingMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_shippingTermId_fkey"
            columns: ["shippingTermId"]
            isOneToOne: false
            referencedRelation: "shippingTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderShipment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderStatusHistory: {
        Row: {
          createdAt: string
          createdBy: string
          id: string
          salesOrderId: string
          status: Database["public"]["Enums"]["salesOrderStatus"]
        }
        Insert: {
          createdAt?: string
          createdBy: string
          id?: string
          salesOrderId: string
          status: Database["public"]["Enums"]["salesOrderStatus"]
        }
        Update: {
          createdAt?: string
          createdBy?: string
          id?: string
          salesOrderId?: string
          status?: Database["public"]["Enums"]["salesOrderStatus"]
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderStatusHistory_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
        ]
      }
      salesOrderTransaction: {
        Row: {
          createdAt: string
          id: string
          salesOrderId: string
          type: Database["public"]["Enums"]["salesOrderTransactionType"]
          userId: string
        }
        Insert: {
          createdAt?: string
          id?: string
          salesOrderId: string
          type: Database["public"]["Enums"]["salesOrderTransactionType"]
          userId: string
        }
        Update: {
          createdAt?: string
          id?: string
          salesOrderId?: string
          type?: Database["public"]["Enums"]["salesOrderTransactionType"]
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderTransaction_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderTransaction_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesRfq: {
        Row: {
          assignee: string | null
          companyId: string
          createdAt: string | null
          createdBy: string | null
          customerContactId: string | null
          customerId: string
          customerLocationId: string | null
          customerReference: string | null
          customFields: Json | null
          employeeId: string | null
          expirationDate: string | null
          externalNotes: Json | null
          id: string
          internalNotes: Json | null
          locationId: string | null
          revisionId: number
          rfqDate: string
          rfqId: string
          status: Database["public"]["Enums"]["salesRfqStatus"]
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          assignee?: string | null
          companyId: string
          createdAt?: string | null
          createdBy?: string | null
          customerContactId?: string | null
          customerId: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          employeeId?: string | null
          expirationDate?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          locationId?: string | null
          revisionId?: number
          rfqDate: string
          rfqId: string
          status?: Database["public"]["Enums"]["salesRfqStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          assignee?: string | null
          companyId?: string
          createdAt?: string | null
          createdBy?: string | null
          customerContactId?: string | null
          customerId?: string
          customerLocationId?: string | null
          customerReference?: string | null
          customFields?: Json | null
          employeeId?: string | null
          expirationDate?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          locationId?: string | null
          revisionId?: number
          rfqDate?: string
          rfqId?: string
          status?: Database["public"]["Enums"]["salesRfqStatus"]
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesRfqFavorite: {
        Row: {
          rfqId: string
          userId: string
        }
        Insert: {
          rfqId: string
          userId: string
        }
        Update: {
          rfqId?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "salesRfqFavorites_salesRfqId_fkey"
            columns: ["rfqId"]
            isOneToOne: false
            referencedRelation: "salesRfq"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_salesRfqId_fkey"
            columns: ["rfqId"]
            isOneToOne: false
            referencedRelation: "salesRfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqFavorites_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesRfqLine: {
        Row: {
          companyId: string
          createdAt: string | null
          createdBy: string
          customerPartId: string
          customerPartRevision: string | null
          customFields: Json | null
          description: string | null
          externalNotes: Json | null
          id: string
          internalNotes: Json | null
          itemId: string | null
          modelUploadId: string | null
          order: number
          quantity: number[] | null
          salesRfqId: string
          unitOfMeasureCode: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string | null
          createdBy: string
          customerPartId: string
          customerPartRevision?: string | null
          customFields?: Json | null
          description?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          itemId?: string | null
          modelUploadId?: string | null
          order?: number
          quantity?: number[] | null
          salesRfqId: string
          unitOfMeasureCode: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string | null
          createdBy?: string
          customerPartId?: string
          customerPartRevision?: string | null
          customFields?: Json | null
          description?: string | null
          externalNotes?: Json | null
          id?: string
          internalNotes?: Json | null
          itemId?: string | null
          modelUploadId?: string | null
          order?: number
          quantity?: number[] | null
          salesRfqId?: string
          unitOfMeasureCode?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfqLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfq"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      search: {
        Row: {
          companyId: string | null
          description: string | null
          entity: Database["public"]["Enums"]["searchEntity"] | null
          fts: unknown | null
          id: number
          link: string
          name: string
          uuid: string | null
        }
        Insert: {
          companyId?: string | null
          description?: string | null
          entity?: Database["public"]["Enums"]["searchEntity"] | null
          fts?: unknown | null
          id?: number
          link: string
          name: string
          uuid?: string | null
        }
        Update: {
          companyId?: string | null
          description?: string | null
          entity?: Database["public"]["Enums"]["searchEntity"] | null
          fts?: unknown | null
          id?: number
          link?: string
          name?: string
          uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_companyid_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_companyid_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_companyid_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "search_companyid_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      sequence: {
        Row: {
          companyId: string
          id: string
          name: string
          next: number
          prefix: string | null
          size: number
          step: number
          suffix: string | null
          table: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          id?: string
          name: string
          next?: number
          prefix?: string | null
          size?: number
          step?: number
          suffix?: string | null
          table: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          id?: string
          name?: string
          next?: number
          prefix?: string | null
          size?: number
          step?: number
          suffix?: string | null
          table?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "sequence_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "sequence_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      service: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          fromDate: string | null
          id: string
          itemId: string | null
          serviceType: Database["public"]["Enums"]["serviceType"]
          toDate: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          fromDate?: string | null
          id: string
          itemId?: string | null
          serviceType: Database["public"]["Enums"]["serviceType"]
          toDate?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          fromDate?: string | null
          id?: string
          itemId?: string | null
          serviceType?: Database["public"]["Enums"]["serviceType"]
          toDate?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "service_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      shelf: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          locationId: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
          warehouseId: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id: string
          locationId: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
          warehouseId?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          locationId?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
          warehouseId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shelf_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shelf_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shelf_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shelf_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shelf_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shelf_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shelf_warehouseId_fkey"
            columns: ["warehouseId"]
            isOneToOne: false
            referencedRelation: "warehouse"
            referencedColumns: ["id"]
          },
        ]
      }
      shift: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          endTime: string
          friday: boolean
          id: string
          locationId: string
          monday: boolean
          name: string
          saturday: boolean
          startTime: string
          sunday: boolean
          thursday: boolean
          tuesday: boolean
          updatedAt: string | null
          updatedBy: string | null
          wednesday: boolean
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          endTime: string
          friday?: boolean
          id?: string
          locationId: string
          monday?: boolean
          name: string
          saturday?: boolean
          startTime: string
          sunday?: boolean
          thursday?: boolean
          tuesday?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
          wednesday?: boolean
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          endTime?: string
          friday?: boolean
          id?: string
          locationId?: string
          monday?: boolean
          name?: string
          saturday?: boolean
          startTime?: string
          sunday?: boolean
          thursday?: boolean
          tuesday?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
          wednesday?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      shippingMethod: {
        Row: {
          active: boolean
          carrier: Database["public"]["Enums"]["shippingCarrier"]
          carrierAccountId: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          trackingUrl: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          carrier?: Database["public"]["Enums"]["shippingCarrier"]
          carrierAccountId?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          trackingUrl?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          carrier?: Database["public"]["Enums"]["shippingCarrier"]
          carrierAccountId?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          trackingUrl?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shippingMethod_carrierAccountId_fkey"
            columns: ["carrierAccountId", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "shippingMethod_carrierAccountId_fkey"
            columns: ["carrierAccountId", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "shippingMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shippingMethod_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shippingMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shippingMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingMethod_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      shippingTerm: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shippingTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shippingTerm_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shippingTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shippingTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shippingTerm_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplier: {
        Row: {
          accountManagerId: string | null
          assignee: string | null
          companyId: string
          createdAt: string
          createdBy: string | null
          customFields: Json | null
          id: string
          logo: string | null
          name: string
          supplierStatusId: string | null
          supplierTypeId: string | null
          taxId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountManagerId?: string | null
          assignee?: string | null
          companyId: string
          createdAt?: string
          createdBy?: string | null
          customFields?: Json | null
          id?: string
          logo?: string | null
          name: string
          supplierStatusId?: string | null
          supplierTypeId?: string | null
          taxId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountManagerId?: string | null
          assignee?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string | null
          customFields?: Json | null
          id?: string
          logo?: string | null
          name?: string
          supplierStatusId?: string | null
          supplierTypeId?: string | null
          taxId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_supplierStatusId_fkey"
            columns: ["supplierStatusId"]
            isOneToOne: false
            referencedRelation: "supplierStatus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_supplierTypeId_fkey"
            columns: ["supplierTypeId"]
            isOneToOne: false
            referencedRelation: "supplierType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierAccount: {
        Row: {
          companyId: string
          id: string
          supplierId: string
        }
        Insert: {
          companyId: string
          id: string
          supplierId: string
        }
        Update: {
          companyId?: string
          id?: string
          supplierId?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplierAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierAccount_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplierAccount_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierAccount_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierAccount_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierAccount_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplierContact: {
        Row: {
          contactId: string
          customFields: Json | null
          id: string
          supplierId: string
          supplierLocationId: string | null
          userId: string | null
        }
        Insert: {
          contactId: string
          customFields?: Json | null
          id?: string
          supplierId: string
          supplierLocationId?: string | null
          userId?: string | null
        }
        Update: {
          contactId?: string
          customFields?: Json | null
          id?: string
          supplierId?: string
          supplierLocationId?: string | null
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierContact_contactId_fkey"
            columns: ["contactId"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierContact_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierContact_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_supplierLocationId_fkey"
            columns: ["supplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierContact_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierLedger: {
        Row: {
          amount: number
          companyId: string
          createdAt: string
          documentId: string | null
          documentType:
            | Database["public"]["Enums"]["supplierLedgerDocumentType"]
            | null
          entryNumber: number
          externalDocumentId: string | null
          id: string
          postingDate: string
          supplierId: string
        }
        Insert: {
          amount: number
          companyId: string
          createdAt?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["supplierLedgerDocumentType"]
            | null
          entryNumber?: number
          externalDocumentId?: string | null
          id?: string
          postingDate?: string
          supplierId: string
        }
        Update: {
          amount?: number
          companyId?: string
          createdAt?: string
          documentId?: string | null
          documentType?:
            | Database["public"]["Enums"]["supplierLedgerDocumentType"]
            | null
          entryNumber?: number
          externalDocumentId?: string | null
          id?: string
          postingDate?: string
          supplierId?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplierLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierLedger_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierLedger_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierLedger_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierLedger_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLedger_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLedger_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplierLocation: {
        Row: {
          addressId: string
          customFields: Json | null
          id: string
          name: string
          supplierId: string
        }
        Insert: {
          addressId: string
          customFields?: Json | null
          id?: string
          name: string
          supplierId: string
        }
        Update: {
          addressId?: string
          customFields?: Json | null
          id?: string
          name?: string
          supplierId?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplierLocation_addressId_fkey"
            columns: ["addressId"]
            isOneToOne: false
            referencedRelation: "address"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLocation_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierLocation_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierLocation_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLocation_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierLocation_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplierPayment: {
        Row: {
          companyId: string
          currencyCode: string | null
          customFields: Json | null
          invoiceSupplierContactId: string | null
          invoiceSupplierId: string | null
          invoiceSupplierLocationId: string | null
          paymentTermId: string | null
          supplierId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          currencyCode?: string | null
          customFields?: Json | null
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentTermId?: string | null
          supplierId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          currencyCode?: string | null
          customFields?: Json | null
          invoiceSupplierContactId?: string | null
          invoiceSupplierId?: string | null
          invoiceSupplierLocationId?: string | null
          paymentTermId?: string | null
          supplierId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierPayment_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierPayment_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierContactId_fkey"
            columns: ["invoiceSupplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_invoiceSupplierLocationId_fkey"
            columns: ["invoiceSupplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierPayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierPayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierPayment_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierProcess: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          leadTime: number
          minimumCost: number
          processId: string
          supplierId: string
          unitCost: number
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          leadTime?: number
          minimumCost?: number
          processId: string
          supplierId: string
          unitCost?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          leadTime?: number
          minimumCost?: number
          processId?: string
          supplierId?: string
          unitCost?: number
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplierProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierShipping: {
        Row: {
          companyId: string
          customFields: Json | null
          shippingMethodId: string | null
          shippingSupplierContactId: string | null
          shippingSupplierId: string | null
          shippingSupplierLocationId: string | null
          shippingTermId: string | null
          supplierId: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          customFields?: Json | null
          shippingMethodId?: string | null
          shippingSupplierContactId?: string | null
          shippingSupplierId?: string | null
          shippingSupplierLocationId?: string | null
          shippingTermId?: string | null
          supplierId: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          customFields?: Json | null
          shippingMethodId?: string | null
          shippingSupplierContactId?: string | null
          shippingSupplierId?: string | null
          shippingSupplierLocationId?: string | null
          shippingTermId?: string | null
          supplierId?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierShipping_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierShipping_shippingMethodId_fkey"
            columns: ["shippingMethodId"]
            isOneToOne: false
            referencedRelation: "shippingMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierContactId_fkey"
            columns: ["shippingSupplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierId_fkey"
            columns: ["shippingSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierId_fkey"
            columns: ["shippingSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierId_fkey"
            columns: ["shippingSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierId_fkey"
            columns: ["shippingSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierId_fkey"
            columns: ["shippingSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingSupplierLocationId_fkey"
            columns: ["shippingSupplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_shippingTermId_fkey"
            columns: ["shippingTermId"]
            isOneToOne: false
            referencedRelation: "shippingTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierShipping_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierShipping_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierShipping_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierStatus: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierStatus_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplierStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierStatus_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierType: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          protected: boolean
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          protected?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          protected?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierType_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplierType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierType_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      terms: {
        Row: {
          id: string
          purchasingTerms: Json | null
          salesTerms: Json | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          id?: string
          purchasingTerms?: Json | null
          salesTerms?: Json | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          id?: string
          purchasingTerms?: Json | null
          salesTerms?: Json | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terms_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "terms_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "terms_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      tool: {
        Row: {
          approved: boolean
          approvedBy: string | null
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          itemId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          approved?: boolean
          approvedBy?: string | null
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          approved?: boolean
          approvedBy?: string | null
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          itemId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "tool_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      unitOfMeasure: {
        Row: {
          active: boolean
          code: string
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          id: string
          name: string
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          code: string
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          id?: string
          name: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          id?: string
          name?: string
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unitOfMeasure_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "unitOfMeasure_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "unitOfMeasure_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "unitOfMeasure_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unitOfMeasure_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      user: {
        Row: {
          about: string
          active: boolean | null
          admin: boolean | null
          avatarUrl: string | null
          createdAt: string
          developer: boolean | null
          email: string
          firstName: string
          fullName: string | null
          id: string
          lastName: string
          updatedAt: string | null
        }
        Insert: {
          about?: string
          active?: boolean | null
          admin?: boolean | null
          avatarUrl?: string | null
          createdAt?: string
          developer?: boolean | null
          email: string
          firstName: string
          fullName?: string | null
          id: string
          lastName: string
          updatedAt?: string | null
        }
        Update: {
          about?: string
          active?: boolean | null
          admin?: boolean | null
          avatarUrl?: string | null
          createdAt?: string
          developer?: boolean | null
          email?: string
          firstName?: string
          fullName?: string | null
          id?: string
          lastName?: string
          updatedAt?: string | null
        }
        Relationships: []
      }
      userAttribute: {
        Row: {
          active: boolean | null
          attributeDataTypeId: number
          canSelfManage: boolean | null
          createdAt: string
          createdBy: string
          id: string
          listOptions: string[] | null
          name: string
          sortOrder: number
          updatedAt: string | null
          updatedBy: string | null
          userAttributeCategoryId: string
        }
        Insert: {
          active?: boolean | null
          attributeDataTypeId: number
          canSelfManage?: boolean | null
          createdAt?: string
          createdBy: string
          id?: string
          listOptions?: string[] | null
          name: string
          sortOrder?: number
          updatedAt?: string | null
          updatedBy?: string | null
          userAttributeCategoryId: string
        }
        Update: {
          active?: boolean | null
          attributeDataTypeId?: number
          canSelfManage?: boolean | null
          createdAt?: string
          createdBy?: string
          id?: string
          listOptions?: string[] | null
          name?: string
          sortOrder?: number
          updatedAt?: string | null
          updatedBy?: string | null
          userAttributeCategoryId?: string
        }
        Relationships: [
          {
            foreignKeyName: "userAttribute_attributeDataTypeId_fkey"
            columns: ["attributeDataTypeId"]
            isOneToOne: false
            referencedRelation: "attributeDataType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttribute_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttribute_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttribute_userAttributeCategoryId_fkey"
            columns: ["userAttributeCategoryId"]
            isOneToOne: false
            referencedRelation: "userAttributeCategory"
            referencedColumns: ["id"]
          },
        ]
      }
      userAttributeCategory: {
        Row: {
          active: boolean | null
          companyId: string | null
          createdAt: string
          createdBy: string
          id: string
          name: string
          protected: boolean | null
          public: boolean | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean | null
          companyId?: string | null
          createdAt?: string
          createdBy: string
          id?: string
          name: string
          protected?: boolean | null
          public?: boolean | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean | null
          companyId?: string | null
          createdAt?: string
          createdBy?: string
          id?: string
          name?: string
          protected?: boolean | null
          public?: boolean | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "userAttributeCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userAttributeCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userAttributeCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttributeCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      userAttributeValue: {
        Row: {
          createdAt: string
          createdBy: string
          id: string
          updatedAt: string | null
          updatedBy: string | null
          userAttributeId: string
          userId: string
          valueBoolean: boolean | null
          valueDate: string | null
          valueNumeric: number | null
          valueText: string | null
          valueUser: string | null
        }
        Insert: {
          createdAt?: string
          createdBy: string
          id?: string
          updatedAt?: string | null
          updatedBy?: string | null
          userAttributeId: string
          userId: string
          valueBoolean?: boolean | null
          valueDate?: string | null
          valueNumeric?: number | null
          valueText?: string | null
          valueUser?: string | null
        }
        Update: {
          createdAt?: string
          createdBy?: string
          id?: string
          updatedAt?: string | null
          updatedBy?: string | null
          userAttributeId?: string
          userId?: string
          valueBoolean?: boolean | null
          valueDate?: string | null
          valueNumeric?: number | null
          valueText?: string | null
          valueUser?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "userAttributeValue_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttributeValue_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttributeValue_userAttributeId_fkey"
            columns: ["userAttributeId"]
            isOneToOne: false
            referencedRelation: "userAttribute"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userAttributeValue_valueUser_fkey"
            columns: ["valueUser"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_valueUser_fkey"
            columns: ["valueUser"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_valueUser_fkey"
            columns: ["valueUser"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_valueUser_fkey"
            columns: ["valueUser"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userAttributeValue_valueUser_fkey"
            columns: ["valueUser"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      userPermission: {
        Row: {
          id: string
          permissions: Json | null
        }
        Insert: {
          id: string
          permissions?: Json | null
        }
        Update: {
          id?: string
          permissions?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "userPermission_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userPermission_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userPermission_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userPermission_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userPermission_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      userToCompany: {
        Row: {
          companyId: string
          role: Database["public"]["Enums"]["role"]
          userId: string
        }
        Insert: {
          companyId: string
          role: Database["public"]["Enums"]["role"]
          userId: string
        }
        Update: {
          companyId?: string
          role?: Database["public"]["Enums"]["role"]
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      warehouse: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          id: string
          locationId: string
          name: string
          requiresBin: boolean
          requiresPick: boolean
          requiresPutAway: boolean
          requiresReceive: boolean
          requiresShipment: boolean
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          id?: string
          locationId: string
          name: string
          requiresBin?: boolean
          requiresPick?: boolean
          requiresPutAway?: boolean
          requiresReceive?: boolean
          requiresShipment?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          id?: string
          locationId?: string
          name?: string
          requiresBin?: boolean
          requiresPick?: boolean
          requiresPutAway?: boolean
          requiresReceive?: boolean
          requiresShipment?: boolean
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "warehouse_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "warehouse_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "warehouse_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "warehouse_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "warehouse_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      workCenter: {
        Row: {
          active: boolean
          companyId: string
          createdAt: string
          createdBy: string
          customFields: Json | null
          defaultStandardFactor: Database["public"]["Enums"]["factor"]
          description: string | null
          id: string
          laborRate: number
          locationId: string | null
          machineRate: number
          name: string
          overheadRate: number
          requiredAbilityId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          active?: boolean
          companyId: string
          createdAt?: string
          createdBy: string
          customFields?: Json | null
          defaultStandardFactor?: Database["public"]["Enums"]["factor"]
          description?: string | null
          id?: string
          laborRate?: number
          locationId?: string | null
          machineRate?: number
          name: string
          overheadRate?: number
          requiredAbilityId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          active?: boolean
          companyId?: string
          createdAt?: string
          createdBy?: string
          customFields?: Json | null
          defaultStandardFactor?: Database["public"]["Enums"]["factor"]
          description?: string | null
          id?: string
          laborRate?: number
          locationId?: string | null
          machineRate?: number
          name?: string
          overheadRate?: number
          requiredAbilityId?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "workCenter_requiredAbilityId_fkey"
            columns: ["requiredAbilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      workCenterProcess: {
        Row: {
          companyId: string
          createdAt: string
          createdBy: string
          processId: string
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string
        }
        Insert: {
          companyId: string
          createdAt?: string
          createdBy: string
          processId: string
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId: string
        }
        Update: {
          companyId?: string
          createdAt?: string
          createdBy?: string
          processId?: string
          updatedAt?: string | null
          updatedBy?: string | null
          workCenterId?: string
        }
        Relationships: [
          {
            foreignKeyName: "workCenterProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenterProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenterProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "workCenterProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "workCenterProcess_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenterProcess_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      accountCategories: {
        Row: {
          category: string | null
          class: Database["public"]["Enums"]["glAccountClass"] | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          id: string | null
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"] | null
          subCategoriesCount: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          category?: string | null
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId?: string | null
          createdAt?: string | null
          createdBy?: string | null
          customFields?: Json | null
          id?: string | null
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null
          subCategoriesCount?: never
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          category?: string | null
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId?: string | null
          createdAt?: string | null
          createdBy?: string | null
          customFields?: Json | null
          id?: string | null
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null
          subCategoriesCount?: never
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountCategory_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountCategory_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      accounts: {
        Row: {
          accountCategory: string | null
          accountCategoryId: string | null
          accountSubCategory: string | null
          accountSubcategoryId: string | null
          active: boolean | null
          class: Database["public"]["Enums"]["glAccountClass"] | null
          companyId: string | null
          consolidatedRate:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          directPosting: boolean | null
          id: string | null
          incomeBalance: Database["public"]["Enums"]["glIncomeBalance"] | null
          name: string | null
          number: string | null
          type: Database["public"]["Enums"]["glAccountType"] | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Insert: {
          accountCategory?: never
          accountCategoryId?: string | null
          accountSubCategory?: never
          accountSubcategoryId?: string | null
          active?: boolean | null
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId?: string | null
          consolidatedRate?:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt?: string | null
          createdBy?: string | null
          customFields?: Json | null
          directPosting?: boolean | null
          id?: string | null
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null
          name?: string | null
          number?: string | null
          type?: Database["public"]["Enums"]["glAccountType"] | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Update: {
          accountCategory?: never
          accountCategoryId?: string | null
          accountSubCategory?: never
          accountSubcategoryId?: string | null
          active?: boolean | null
          class?: Database["public"]["Enums"]["glAccountClass"] | null
          companyId?: string | null
          consolidatedRate?:
            | Database["public"]["Enums"]["glConsolidatedRate"]
            | null
          createdAt?: string | null
          createdBy?: string | null
          customFields?: Json | null
          directPosting?: boolean | null
          id?: string | null
          incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null
          name?: string | null
          number?: string | null
          type?: Database["public"]["Enums"]["glAccountType"] | null
          updatedAt?: string | null
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_accountCategoryId_fkey"
            columns: ["accountCategoryId"]
            isOneToOne: false
            referencedRelation: "accountCategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "account_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      companies: {
        Row: {
          addressLine1: string | null
          addressLine2: string | null
          city: string | null
          companyId: string | null
          countryCode: string | null
          email: string | null
          employeeType: string | null
          fax: string | null
          id: string | null
          logo: string | null
          name: string | null
          phone: string | null
          postalCode: string | null
          role: Database["public"]["Enums"]["role"] | null
          state: string | null
          taxId: string | null
          updatedBy: string | null
          userId: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountDefault_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userToCompany_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "userToCompany_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      consumables: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          id: string | null
          itemId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          supplierIds: string[] | null
          unitOfMeasure: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "consumable_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "consumable_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      contractors: {
        Row: {
          abilityIds: string[] | null
          active: boolean | null
          companyId: string | null
          customFields: Json | null
          email: string | null
          firstName: string | null
          hoursPerWeek: number | null
          lastName: string | null
          supplierContactId: string | null
          supplierId: string | null
          supplierName: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "contractor_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "contractor_id_fkey"
            columns: ["supplierContactId"]
            isOneToOne: true
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          accountManagerId: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customerStatusId: string | null
          customerTypeId: string | null
          customFields: Json | null
          id: string | null
          logo: string | null
          name: string | null
          orderCount: number | null
          status: string | null
          taxId: string | null
          type: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "customer_customerStatusId_fkey"
            columns: ["customerStatusId"]
            isOneToOne: false
            referencedRelation: "customerStatus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_customerTypeId_fkey"
            columns: ["customerTypeId"]
            isOneToOne: false
            referencedRelation: "customerType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      customFieldTables: {
        Row: {
          companyId: string | null
          fields: Json | null
          module: Database["public"]["Enums"]["module"] | null
          name: string | null
          table: string | null
        }
        Relationships: []
      }
      documentExtensions: {
        Row: {
          extension: string | null
        }
        Relationships: []
      }
      documentLabels: {
        Row: {
          label: string | null
          userId: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentLabels_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      documents: {
        Row: {
          active: boolean | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          description: string | null
          extension: string | null
          favorite: boolean | null
          id: string | null
          labels: string[] | null
          lastActivityAt: string | null
          name: string | null
          path: string | null
          readGroups: string[] | null
          size: number | null
          sourceDocument:
            | Database["public"]["Enums"]["documentSourceType"]
            | null
          sourceDocumentId: string | null
          type: Database["public"]["Enums"]["documentType"] | null
          updatedAt: string | null
          updatedBy: string | null
          writeGroups: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean | null
          avatarUrl: string | null
          companyId: string | null
          email: string | null
          employeeTypeId: string | null
          firstName: string | null
          id: string | null
          lastName: string | null
          name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employee_employeeTypeId_fkey"
            columns: ["employeeTypeId"]
            isOneToOne: false
            referencedRelation: "employeeType"
            referencedColumns: ["id"]
          },
        ]
      }
      employeesAcrossCompanies: {
        Row: {
          active: boolean | null
          avatarUrl: string | null
          companyId: string[] | null
          email: string | null
          firstName: string | null
          id: string | null
          lastName: string | null
          name: string | null
        }
        Relationships: []
      }
      employeeSummary: {
        Row: {
          avatarUrl: string | null
          companyId: string | null
          departmentName: string | null
          id: string | null
          locationName: string | null
          managerName: string | null
          name: string | null
          startDate: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "employee_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      fixtures: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          autodeskUrn: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customer: string | null
          customerId: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          id: string | null
          itemId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          supplierIds: string[] | null
          thumbnailPath: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fixture_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      groupMembers: {
        Row: {
          companyId: string | null
          groupId: string | null
          id: number | null
          isCustomerOrgGroup: boolean | null
          isCustomerTypeGroup: boolean | null
          isEmployeeTypeGroup: boolean | null
          isIdentityGroup: boolean | null
          isSupplierOrgGroup: boolean | null
          isSupplierTypeGroup: boolean | null
          memberGroupId: string | null
          memberUserId: string | null
          name: string | null
          user: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "group_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "membership_groupId_fkey"
            columns: ["groupId"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberGroupId_fkey"
            columns: ["memberGroupId"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_memberUserId_fkey"
            columns: ["memberUserId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      groups: {
        Row: {
          companyId: string | null
          id: string | null
          isCustomerOrgGroup: boolean | null
          isCustomerTypeGroup: boolean | null
          isEmployeeTypeGroup: boolean | null
          isSupplierOrgGroup: boolean | null
          isSupplierTypeGroup: boolean | null
          name: string | null
          parentId: string | null
          users: Json | null
        }
        Relationships: []
      }
      groups_recursive: {
        Row: {
          companyId: string | null
          groupId: string | null
          isCustomerOrgGroup: boolean | null
          isCustomerTypeGroup: boolean | null
          isEmployeeTypeGroup: boolean | null
          isIdentityGroup: boolean | null
          isSupplierOrgGroup: boolean | null
          isSupplierTypeGroup: boolean | null
          name: string | null
          parentId: string | null
          user: Json | null
        }
        Relationships: []
      }
      holidayYears: {
        Row: {
          companyId: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "holiday_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      integrations: {
        Row: {
          active: boolean | null
          companyId: string | null
          description: string | null
          id: string | null
          jsonschema: Json | null
          logoPath: string | null
          metadata: Json | null
          title: string | null
          visible: boolean | null
        }
        Relationships: []
      }
      jobMaterialWithMakeMethodId: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          description: string | null
          estimatedQuantity: number | null
          id: string | null
          itemId: string | null
          itemReadableId: string | null
          itemType: string | null
          jobId: string | null
          jobMakeMethodId: string | null
          jobMaterialMakeMethodId: string | null
          jobOperationId: string | null
          methodType: Database["public"]["Enums"]["methodType"] | null
          order: number | null
          quantity: number | null
          scrapQuantity: number | null
          unitCost: number | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobMaterial_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMaterialWithMakeMethodId"
            referencedColumns: ["jobMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "jobMaterial_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_jobOperationId_fkey"
            columns: ["jobOperationId"]
            isOneToOne: false
            referencedRelation: "jobOperationsWithMakeMethods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      jobOperationsWithMakeMethods: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          description: string | null
          id: string | null
          jobId: string | null
          jobMakeMethodId: string | null
          laborRate: number | null
          laborTime: number | null
          laborUnit: Database["public"]["Enums"]["factor"] | null
          machineRate: number | null
          machineTime: number | null
          machineUnit: Database["public"]["Enums"]["factor"] | null
          makeMethodId: string | null
          operationLeadTime: number | null
          operationMinimumCost: number | null
          operationOrder:
            | Database["public"]["Enums"]["methodOperationOrder"]
            | null
          operationQuantity: number | null
          operationSupplierProcessId: string | null
          operationType: Database["public"]["Enums"]["operationType"] | null
          operationUnitCost: number | null
          order: number | null
          overheadRate: number | null
          processId: string | null
          quantityComplete: number | null
          quantityReworked: number | null
          quantityScrapped: number | null
          setupTime: number | null
          setupUnit: Database["public"]["Enums"]["factor"] | null
          status: Database["public"]["Enums"]["jobOperationStatus"] | null
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
          workInstruction: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobOperation_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobId_fkey"
            columns: ["jobId"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_jobMakeMethodId_fkey"
            columns: ["jobMakeMethodId"]
            isOneToOne: false
            referencedRelation: "jobMaterialWithMakeMethodId"
            referencedColumns: ["jobMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "jobOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "jobOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          active: boolean | null
          assignee: string | null
          autodeskUrn: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customerId: string | null
          customFields: Json | null
          deadlineType: Database["public"]["Enums"]["deadlineType"] | null
          description: string | null
          dueDate: string | null
          id: string | null
          itemId: string | null
          itemReadableId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          itemType: Database["public"]["Enums"]["itemType"] | null
          jobId: string | null
          locationId: string | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          modelUploadId: string | null
          name: string | null
          notes: Json | null
          productionQuantity: number | null
          quantity: number | null
          quantityComplete: number | null
          quantityReceivedToInventory: number | null
          quantityShipped: number | null
          quoteId: string | null
          quoteLineId: string | null
          quoteReadableId: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          salesOrderId: string | null
          salesOrderLineId: string | null
          salesOrderReadableId: string | null
          scrapQuantity: number | null
          status: Database["public"]["Enums"]["jobStatus"] | null
          thumbnailPath: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "job_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "job_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "job_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderLineId_fkey"
            columns: ["salesOrderLineId"]
            isOneToOne: false
            referencedRelation: "salesOrderLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_salesOrderLineId_fkey"
            columns: ["salesOrderLineId"]
            isOneToOne: false
            referencedRelation: "salesOrderLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      materials: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          dimensions: string | null
          finish: string | null
          grade: string | null
          id: string | null
          itemId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          materialForm: string | null
          materialFormId: string | null
          materialSubstance: string | null
          materialSubstanceId: string | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          supplierIds: string[] | null
          unitOfMeasure: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "material_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "material_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_materialFormId_fkey"
            columns: ["materialFormId"]
            isOneToOne: false
            referencedRelation: "materialForm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_materialSubstanceId_fkey"
            columns: ["materialSubstanceId"]
            isOneToOne: false
            referencedRelation: "materialSubstance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      modules: {
        Row: {
          name: Database["public"]["Enums"]["module"] | null
        }
        Relationships: []
      }
      partners: {
        Row: {
          abilityId: string | null
          abilityName: string | null
          active: boolean | null
          city: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          hoursPerWeek: number | null
          id: string | null
          state: string | null
          supplierId: string | null
          supplierLocationId: string | null
          supplierName: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_abilityId_fkey"
            columns: ["abilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "partner_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "partner_id_fkey"
            columns: ["supplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      parts: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          autodeskUrn: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          fromDate: string | null
          id: string | null
          itemId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          supplierIds: string[] | null
          thumbnailPath: string | null
          toDate: string | null
          unitOfMeasure: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "part_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "part_id_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      processes: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultStandardFactor: Database["public"]["Enums"]["factor"] | null
          id: string | null
          name: string | null
          processType: Database["public"]["Enums"]["processType"] | null
          suppliers: Json | null
          updatedAt: string | null
          updatedBy: string | null
          workCenters: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "process_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseInvoices: {
        Row: {
          assignee: string | null
          balance: number | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          currencyCode: string | null
          customFields: Json | null
          dateDue: string | null
          dateIssued: string | null
          datePaid: string | null
          exchangeRate: number | null
          id: string | null
          invoiceId: string | null
          invoiceSupplierId: string | null
          paymentTermId: string | null
          paymentTermName: string | null
          postingDate: string | null
          status: Database["public"]["Enums"]["purchaseInvoiceStatus"] | null
          subtotal: number | null
          supplierId: string | null
          supplierReference: string | null
          totalAmount: number | null
          totalDiscount: number | null
          totalTax: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseInvoice_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_invoiceSupplierId_fkey"
            columns: ["invoiceSupplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_paymentTermId_fkey"
            columns: ["paymentTermId"]
            isOneToOne: false
            referencedRelation: "paymentTerm"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseInvoice_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderLines: {
        Row: {
          accountNumber: string | null
          assetId: string | null
          companyId: string | null
          conversionFactor: number | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          description: string | null
          id: string | null
          inventoryUnitOfMeasureCode: string | null
          invoicedComplete: boolean | null
          itemDescription: string | null
          itemId: string | null
          itemName: string | null
          itemReadableId: string | null
          locationId: string | null
          purchaseOrderId: string | null
          purchaseOrderLineType:
            | Database["public"]["Enums"]["purchaseOrderLineType"]
            | null
          purchaseQuantity: number | null
          purchaseUnitOfMeasureCode: string | null
          quantityInvoiced: number | null
          quantityReceived: number | null
          quantityToInvoice: number | null
          quantityToReceive: number | null
          receivedComplete: boolean | null
          requiresInspection: boolean | null
          setupPrice: number | null
          shelfId: string | null
          supplierId: string | null
          supplierPartId: string | null
          unitPrice: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_inventoryUnitOfMeasureCode_fkey"
            columns: ["inventoryUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseOrderId_fkey"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_purchaseUnitOfMeasureCode_fkey"
            columns: ["purchaseUnitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "purchaseOrderLine_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderLocations: {
        Row: {
          customerAddressLine1: string | null
          customerAddressLine2: string | null
          customerCity: string | null
          customerCountryCode: number | null
          customerName: string | null
          customerPostalCode: string | null
          customerState: string | null
          deliveryAddressLine1: string | null
          deliveryAddressLine2: string | null
          deliveryCity: string | null
          deliveryCountryCode: string | null
          deliveryName: string | null
          deliveryPostalCode: string | null
          deliveryState: string | null
          dropShipment: boolean | null
          id: string | null
          supplierAddressLine1: string | null
          supplierAddressLine2: string | null
          supplierCity: string | null
          supplierCountryCode: number | null
          supplierName: string | null
          supplierPostalCode: string | null
          supplierState: string | null
        }
        Relationships: [
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["customerCountryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["supplierCountryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
        ]
      }
      purchaseOrders: {
        Row: {
          assignee: string | null
          closedAt: string | null
          closedBy: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          dropShipment: boolean | null
          favorite: boolean | null
          id: string | null
          locationId: string | null
          locationName: string | null
          notes: string | null
          orderDate: string | null
          paymentTermName: string | null
          purchaseOrderId: string | null
          receiptPromisedDate: string | null
          receiptRequestedDate: string | null
          revisionId: number | null
          shippingMethodName: string | null
          shippingTermName: string | null
          status: Database["public"]["Enums"]["purchaseOrderStatus"] | null
          supplierContactId: string | null
          supplierId: string | null
          supplierLocationId: string | null
          supplierReference: string | null
          type: Database["public"]["Enums"]["purchaseOrderType"] | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierContactId_fkey"
            columns: ["supplierContactId"]
            isOneToOne: false
            referencedRelation: "supplierContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_supplierLocationId_fkey"
            columns: ["supplierLocationId"]
            isOneToOne: false
            referencedRelation: "supplierLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchaseOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      purchaseOrderSuppliers: {
        Row: {
          companyId: string | null
          id: string | null
          name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      quoteCustomerDetails: {
        Row: {
          customerAddressLine1: string | null
          customerAddressLine2: string | null
          customerCity: string | null
          customerCountryCode: number | null
          customerName: string | null
          customerPostalCode: string | null
          customerState: string | null
          quoteId: string | null
        }
        Relationships: [
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["customerCountryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
        ]
      }
      quoteLines: {
        Row: {
          additionalCharges: Json | null
          autodeskUrn: string | null
          companyId: string | null
          createdBy: string | null
          customerPartId: string | null
          customerPartRevision: string | null
          customFields: Json | null
          description: string | null
          estimatorId: string | null
          id: string | null
          itemId: string | null
          itemReadableId: string | null
          itemType: string | null
          locationId: string | null
          methodType: Database["public"]["Enums"]["methodType"] | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          modelUploadId: string | null
          noQuoteReason: string | null
          notes: Json | null
          quantity: number[] | null
          quoteId: string | null
          quoteRevisionId: number | null
          status: Database["public"]["Enums"]["quoteLineStatus"] | null
          thumbnailPath: string | null
          unitCost: number | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteLine_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteLine_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteMaterialWithMakeMethodId: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          description: string | null
          id: string | null
          itemId: string | null
          itemReadableId: string | null
          itemType: string | null
          methodType: Database["public"]["Enums"]["methodType"] | null
          order: number | null
          quantity: number | null
          quoteId: string | null
          quoteLineId: string | null
          quoteMakeMethodId: string | null
          quoteMaterialMakeMethodId: string | null
          quoteOperationId: string | null
          unitCost: number | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteMaterial_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMaterialWithMakeMethodId"
            referencedColumns: ["quoteMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteOperationId_fkey"
            columns: ["quoteOperationId"]
            isOneToOne: false
            referencedRelation: "quoteOperation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_quoteOperationId_fkey"
            columns: ["quoteOperationId"]
            isOneToOne: false
            referencedRelation: "quoteOperationsWithMakeMethods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteMaterial_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      quoteOperationsWithMakeMethods: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          description: string | null
          id: string | null
          laborRate: number | null
          laborTime: number | null
          laborUnit: Database["public"]["Enums"]["factor"] | null
          machineRate: number | null
          machineTime: number | null
          machineUnit: Database["public"]["Enums"]["factor"] | null
          makeMethodId: string | null
          operationLeadTime: number | null
          operationMinimumCost: number | null
          operationOrder:
            | Database["public"]["Enums"]["methodOperationOrder"]
            | null
          operationSupplierProcessId: string | null
          operationType: Database["public"]["Enums"]["operationType"] | null
          operationUnitCost: number | null
          order: number | null
          overheadRate: number | null
          processId: string | null
          quoteId: string | null
          quoteLineId: string | null
          quoteMakeMethodId: string | null
          setupTime: number | null
          setupUnit: Database["public"]["Enums"]["factor"] | null
          updatedAt: string | null
          updatedBy: string | null
          workCenterId: string | null
          workInstruction: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteOperation_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcess"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_operationSupplierProcessId_fkey"
            columns: ["operationSupplierProcessId"]
            isOneToOne: false
            referencedRelation: "supplierProcesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "quoteOperation_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLine"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteLineId_fkey"
            columns: ["quoteLineId"]
            isOneToOne: false
            referencedRelation: "quoteLines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMakeMethod"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_quoteMakeMethodId_fkey"
            columns: ["quoteMakeMethodId"]
            isOneToOne: false
            referencedRelation: "quoteMaterialWithMakeMethodId"
            referencedColumns: ["quoteMaterialMakeMethodId"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quoteOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quoteOperation_workCenterId_fkey"
            columns: ["workCenterId"]
            isOneToOne: false
            referencedRelation: "workCenters"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          assignee: string | null
          companyId: string | null
          completedLines: number | null
          createdAt: string | null
          createdBy: string | null
          customerContactId: string | null
          customerId: string | null
          customerLocationId: string | null
          customerReference: string | null
          customFields: Json | null
          dueDate: string | null
          estimatorId: string | null
          expirationDate: string | null
          externalNotes: Json | null
          favorite: boolean | null
          id: string | null
          internalNotes: Json | null
          lines: number | null
          locationId: string | null
          locationName: string | null
          quoteId: string | null
          revisionId: number | null
          salesOrderId: string | null
          salesPersonId: string | null
          salesRfqId: string | null
          status: Database["public"]["Enums"]["quoteStatus"] | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfq"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quote_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_estimatorId_fkey"
            columns: ["estimatorId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quote_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_salesPersonId_fkey"
            columns: ["salesPersonId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      receipts: {
        Row: {
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          externalDocumentId: string | null
          id: string | null
          invoiced: boolean | null
          locationId: string | null
          locationName: string | null
          postingDate: string | null
          receiptId: string | null
          sourceDocument:
            | Database["public"]["Enums"]["receiptSourceDocument"]
            | null
          sourceDocumentId: string | null
          sourceDocumentReadableId: string | null
          status: Database["public"]["Enums"]["receiptStatus"] | null
          supplierId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "receipt_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receipt_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderCustomers: {
        Row: {
          companyId: string | null
          id: string | null
          name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "customer_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      salesOrderLines: {
        Row: {
          accountNumber: string | null
          addOnCost: number | null
          assetId: string | null
          autodeskUrn: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customerPartId: string | null
          customerPartRevision: string | null
          customFields: Json | null
          description: string | null
          id: string | null
          invoicedComplete: boolean | null
          itemId: string | null
          itemReadableId: string | null
          locationId: string | null
          methodType: Database["public"]["Enums"]["methodType"] | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          modelUploadId: string | null
          promisedDate: string | null
          quantityInvoiced: number | null
          quantitySent: number | null
          quantityToInvoice: number | null
          quantityToSend: number | null
          requiresInspection: boolean | null
          saleQuantity: number | null
          salesOrderId: string | null
          salesOrderLineType:
            | Database["public"]["Enums"]["salesOrderLineType"]
            | null
          sentComplete: boolean | null
          setupPrice: number | null
          shelfId: string | null
          status: Database["public"]["Enums"]["salesOrderLineStatus"] | null
          thumbnailPath: string | null
          unitCost: number | null
          unitOfMeasureCode: string | null
          unitPrice: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_accountNumber_fkey"
            columns: ["accountNumber", "companyId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["number", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrderLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_shelfId_fkey"
            columns: ["shelfId"]
            isOneToOne: false
            referencedRelation: "shelf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrderLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesOrderLocations: {
        Row: {
          customerAddressLine1: string | null
          customerAddressLine2: string | null
          customerCity: string | null
          customerCountryCode: number | null
          customerName: string | null
          customerPostalCode: string | null
          customerState: string | null
          id: string | null
          paymentAddressLine1: string | null
          paymentAddressLine2: string | null
          paymentCity: string | null
          paymentCountryCode: number | null
          paymentCustomerName: string | null
          paymentPostalCode: string | null
          paymentState: string | null
        }
        Relationships: [
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["paymentCountryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_countryCode_fkey"
            columns: ["customerCountryCode"]
            isOneToOne: false
            referencedRelation: "country"
            referencedColumns: ["id"]
          },
        ]
      }
      salesOrders: {
        Row: {
          assignee: string | null
          closedAt: string | null
          closedBy: string | null
          closedByAvatar: string | null
          closedByFullName: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          createdByAvatar: string | null
          createdByFullName: string | null
          currencyCode: string | null
          customerContactId: string | null
          customerId: string | null
          customerLocationId: string | null
          customerName: string | null
          customerReference: string | null
          customFields: Json | null
          dropShipment: boolean | null
          favorite: boolean | null
          id: string | null
          locationId: string | null
          locationName: string | null
          notes: string | null
          orderDate: string | null
          paymentTermName: string | null
          receiptPromisedDate: string | null
          receiptRequestedDate: string | null
          revisionId: number | null
          salesOrderId: string | null
          shippingMethodName: string | null
          shippingTermName: string | null
          status: Database["public"]["Enums"]["salesOrderStatus"] | null
          updatedAt: string | null
          updatedBy: string | null
          updatedByAvatar: string | null
          updatedByFullName: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_closedBy_fkey"
            columns: ["closedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrder_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesOrder_currencyCode_fkey"
            columns: ["currencyCode", "companyId"]
            isOneToOne: false
            referencedRelation: "currency"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesOrder_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesOrder_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesRfqLines: {
        Row: {
          autodeskUrn: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customerPartId: string | null
          customerPartRevision: string | null
          customFields: Json | null
          description: string | null
          externalNotes: Json | null
          id: string | null
          internalNotes: Json | null
          itemId: string | null
          itemName: string | null
          itemReadableId: string | null
          itemType: Database["public"]["Enums"]["itemType"] | null
          methodType: Database["public"]["Enums"]["methodType"] | null
          modelId: string | null
          modelName: string | null
          modelPath: string | null
          modelSize: number | null
          modelUploadId: string | null
          order: number | null
          quantity: number[] | null
          salesRfqId: string | null
          thumbnailPath: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfqLine_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfq"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_salesRfqId_fkey"
            columns: ["salesRfqId"]
            isOneToOne: false
            referencedRelation: "salesRfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_unitOfMeasureCode_fkey"
            columns: ["unitOfMeasureCode", "companyId"]
            isOneToOne: false
            referencedRelation: "unitOfMeasure"
            referencedColumns: ["code", "companyId"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfqLine_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      salesRfqs: {
        Row: {
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customerContactId: string | null
          customerId: string | null
          customerLocationId: string | null
          customerReference: string | null
          customFields: Json | null
          employeeId: string | null
          expirationDate: string | null
          externalNotes: Json | null
          favorite: boolean | null
          id: string | null
          internalNotes: Json | null
          locationId: string | null
          locationName: string | null
          quoteId: string | null
          revisionId: number | null
          rfqDate: string | null
          rfqId: string | null
          salesOrderId: string | null
          status: Database["public"]["Enums"]["salesRfqStatus"] | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quoteCustomerDetails"
            referencedColumns: ["quoteId"]
          },
          {
            foreignKeyName: "opportunity_quoteId_fkey"
            columns: ["quoteId"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrderLocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_salesOrderId_fkey"
            columns: ["salesOrderId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_assigneeId_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfq_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_customerContactId_fkey"
            columns: ["customerContactId"]
            isOneToOne: false
            referencedRelation: "customerContact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "salesOrderCustomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_customerLocationId_fkey"
            columns: ["customerLocationId"]
            isOneToOne: false
            referencedRelation: "customerLocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_employeeId_fkey"
            columns: ["employeeId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesRfq_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salesRfq_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          fromDate: string | null
          id: string | null
          itemId: string | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          serviceType: Database["public"]["Enums"]["serviceType"] | null
          supplierIds: string[] | null
          toDate: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "service_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "service_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      shifts: {
        Row: {
          active: boolean | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          endTime: string | null
          friday: boolean | null
          id: string | null
          locationId: string | null
          locationName: string | null
          monday: boolean | null
          name: string | null
          saturday: boolean | null
          startTime: string | null
          sunday: boolean | null
          thursday: boolean | null
          tuesday: boolean | null
          updatedAt: string | null
          updatedBy: string | null
          wednesday: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shifts_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shifts_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      supplierProcesses: {
        Row: {
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          id: string | null
          leadTime: number | null
          minimumCost: number | null
          processId: string | null
          processName: string | null
          supplierId: string | null
          unitCost: number | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierProcess_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplierProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "process"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_processId_fkey"
            columns: ["processId"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["supplierId"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "purchaseOrderSuppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_supplierId_fkey"
            columns: ["supplierId"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplierProcess_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      suppliers: {
        Row: {
          accountManagerId: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          id: string | null
          logo: string | null
          name: string | null
          orderCount: number | null
          partCount: number | null
          status: string | null
          supplierStatusId: string | null
          supplierTypeId: string | null
          taxId: string | null
          type: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accountManagerId_fkey"
            columns: ["accountManagerId"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplier_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "supplier_supplierStatusId_fkey"
            columns: ["supplierStatusId"]
            isOneToOne: false
            referencedRelation: "supplierStatus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_supplierTypeId_fkey"
            columns: ["supplierTypeId"]
            isOneToOne: false
            referencedRelation: "supplierType"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      tools: {
        Row: {
          active: boolean | null
          approved: boolean | null
          approvedBy: string | null
          assignee: string | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultMethodType: Database["public"]["Enums"]["methodType"] | null
          description: string | null
          id: string | null
          itemId: string | null
          itemTrackingType:
            | Database["public"]["Enums"]["itemTrackingType"]
            | null
          name: string | null
          replenishmentSystem:
            | Database["public"]["Enums"]["itemReplenishmentSystem"]
            | null
          supplierIds: string[] | null
          unitOfMeasure: string | null
          unitOfMeasureCode: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "tool_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "tool_itemId_fkey"
            columns: ["itemId"]
            isOneToOne: false
            referencedRelation: "item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
      userDefaults: {
        Row: {
          companyId: string | null
          locationId: string | null
          userId: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "employeeJob_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "location_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
        ]
      }
      workCenters: {
        Row: {
          active: boolean | null
          companyId: string | null
          createdAt: string | null
          createdBy: string | null
          customFields: Json | null
          defaultStandardFactor: Database["public"]["Enums"]["factor"] | null
          description: string | null
          id: string | null
          laborRate: number | null
          locationId: string | null
          locationName: string | null
          machineRate: number | null
          name: string | null
          overheadRate: number | null
          processes: Json | null
          requiredAbilityId: string | null
          updatedAt: string | null
          updatedBy: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "customFieldTables"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenter_companyId_fkey"
            columns: ["companyId"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["companyId"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "purchaseOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "workCenter_locationId_fkey"
            columns: ["locationId"]
            isOneToOne: false
            referencedRelation: "salesOrders"
            referencedColumns: ["locationId"]
          },
          {
            foreignKeyName: "workCenter_requiredAbilityId_fkey"
            columns: ["requiredAbilityId"]
            isOneToOne: false
            referencedRelation: "ability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeeSummary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "employeesAcrossCompanies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workCenter_updatedBy_fkey"
            columns: ["updatedBy"]
            isOneToOne: false
            referencedRelation: "userDefaults"
            referencedColumns: ["userId"]
          },
        ]
      }
    }
    Functions: {
      _xid_machine_id: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      get_active_job_count: {
        Args: {
          employee_id: string
          company_id: string
        }
        Returns: number
      }
      get_active_job_operations_by_employee: {
        Args: {
          employee_id: string
          company_id: string
        }
        Returns: {
          id: string
          jobId: string
          operationOrder: number
          processId: string
          workCenterId: string
          description: string
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationOrderType: Database["public"]["Enums"]["methodOperationOrder"]
          jobReadableId: string
          jobStatus: Database["public"]["Enums"]["jobStatus"]
          jobDueDate: string
          jobDeadlineType: Database["public"]["Enums"]["deadlineType"]
          parentMaterialId: string
          itemReadableId: string
          operationStatus: Database["public"]["Enums"]["jobOperationStatus"]
          operationQuantity: number
          quantityComplete: number
          quantityScrapped: number
        }[]
      }
      get_claims: {
        Args: {
          uid: string
          company: string
        }
        Returns: Json
      }
      get_company_id_from_api_key: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_company_id_from_foreign_key: {
        Args: {
          foreign_key: string
          tbl: string
        }
        Returns: string
      }
      get_item_quantities: {
        Args: {
          location_id: string
        }
        Returns: {
          itemId: string
          companyId: string
          locationId: string
          quantityOnHand: number
          quantityOnPurchaseOrder: number
          quantityOnSalesOrder: number
          quantityOnProdOrder: number
          quantityAvailable: number
          materialSubstanceId: string
          materialFormId: string
          grade: string
          dimensions: string
          finish: string
          readableId: string
          type: Database["public"]["Enums"]["itemType"]
          name: string
          active: boolean
          itemTrackingType: Database["public"]["Enums"]["itemTrackingType"]
          thumbnailPath: string
          locationName: string
          unitOfMeasureCode: string
        }[]
      }
      get_job_method: {
        Args: {
          jid: string
        }
        Returns: {
          jobId: string
          methodMaterialId: string
          jobMakeMethodId: string
          jobMaterialMakeMethodId: string
          itemId: string
          itemReadableId: string
          itemType: string
          quantity: number
          unitCost: number
          methodType: Database["public"]["Enums"]["methodType"]
          parentMaterialId: string
          order: number
          isRoot: boolean
        }[]
      }
      get_job_methods_by_method_id: {
        Args: {
          mid: string
        }
        Returns: {
          jobId: string
          methodMaterialId: string
          jobMakeMethodId: string
          jobMaterialMakeMethodId: string
          itemId: string
          itemReadableId: string
          description: string
          unitOfMeasureCode: string
          itemType: string
          quantity: number
          unitCost: number
          methodType: Database["public"]["Enums"]["methodType"]
          parentMaterialId: string
          order: number
          isRoot: boolean
        }[]
      }
      get_job_operation_by_id: {
        Args: {
          operation_id: string
        }
        Returns: {
          id: string
          jobId: string
          jobMakeMethodId: string
          operationOrder: number
          processId: string
          workCenterId: string
          description: string
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationOrderType: Database["public"]["Enums"]["methodOperationOrder"]
          jobReadableId: string
          jobStatus: Database["public"]["Enums"]["jobStatus"]
          jobDueDate: string
          jobDeadlineType: Database["public"]["Enums"]["deadlineType"]
          parentMaterialId: string
          itemReadableId: string
          itemDescription: string
          itemUnitOfMeasure: string
          itemAutodeskUrn: string
          operationStatus: Database["public"]["Enums"]["jobOperationStatus"]
          operationQuantity: number
          quantityComplete: number
          quantityReworked: number
          quantityScrapped: number
          workInstruction: Json
        }[]
      }
      get_job_operations_by_work_center: {
        Args: {
          work_center_id: string
          location_id: string
        }
        Returns: {
          id: string
          jobId: string
          operationOrder: number
          processId: string
          workCenterId: string
          description: string
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationOrderType: Database["public"]["Enums"]["methodOperationOrder"]
          jobReadableId: string
          jobStatus: Database["public"]["Enums"]["jobStatus"]
          jobDueDate: string
          jobDeadlineType: Database["public"]["Enums"]["deadlineType"]
          parentMaterialId: string
          itemReadableId: string
          operationStatus: Database["public"]["Enums"]["jobOperationStatus"]
          operationQuantity: number
          quantityComplete: number
          quantityScrapped: number
        }[]
      }
      get_method_tree: {
        Args: {
          uid: string
        }
        Returns: {
          methodMaterialId: string
          makeMethodId: string
          materialMakeMethodId: string
          itemId: string
          itemReadableId: string
          itemType: string
          description: string
          unitOfMeasureCode: string
          unitCost: number
          quantity: number
          methodType: Database["public"]["Enums"]["methodType"]
          parentMaterialId: string
          order: number
          operationId: string
          isRoot: boolean
        }[]
      }
      get_my_claim: {
        Args: {
          claim: string
        }
        Returns: Json
      }
      get_my_permission: {
        Args: {
          claim: string
        }
        Returns: Json
      }
      get_permission_companies: {
        Args: {
          claim: string
        }
        Returns: string[]
      }
      get_quote_methods: {
        Args: {
          qid: string
        }
        Returns: {
          quoteId: string
          quoteLineId: string
          methodMaterialId: string
          quoteMakeMethodId: string
          quoteMaterialMakeMethodId: string
          itemId: string
          itemReadableId: string
          itemType: string
          quantity: number
          unitCost: number
          methodType: Database["public"]["Enums"]["methodType"]
          parentMaterialId: string
          order: number
          isRoot: boolean
        }[]
      }
      get_quote_methods_by_method_id: {
        Args: {
          mid: string
        }
        Returns: {
          quoteId: string
          quoteLineId: string
          methodMaterialId: string
          quoteMakeMethodId: string
          quoteMaterialMakeMethodId: string
          itemId: string
          itemReadableId: string
          description: string
          unitOfMeasureCode: string
          itemType: string
          quantity: number
          unitCost: number
          methodType: Database["public"]["Enums"]["methodType"]
          parentMaterialId: string
          order: number
          isRoot: boolean
        }[]
      }
      get_recent_job_operations_by_employee: {
        Args: {
          employee_id: string
          company_id: string
        }
        Returns: {
          id: string
          jobId: string
          operationOrder: number
          processId: string
          workCenterId: string
          description: string
          setupTime: number
          setupUnit: Database["public"]["Enums"]["factor"]
          laborTime: number
          laborUnit: Database["public"]["Enums"]["factor"]
          machineTime: number
          machineUnit: Database["public"]["Enums"]["factor"]
          operationOrderType: Database["public"]["Enums"]["methodOperationOrder"]
          jobReadableId: string
          jobStatus: Database["public"]["Enums"]["jobStatus"]
          jobDueDate: string
          jobDeadlineType: Database["public"]["Enums"]["deadlineType"]
          parentMaterialId: string
          itemReadableId: string
          operationStatus: Database["public"]["Enums"]["jobOperationStatus"]
          operationQuantity: number
          quantityComplete: number
          quantityScrapped: number
        }[]
      }
      groups_for_user: {
        Args: {
          uid: string
        }
        Returns: string[]
      }
      groups_query: {
        Args: {
          _name?: string
          _uid?: string
        }
        Returns: {
          id: string
          name: string
          companyId: string
          parentId: string
          isEmployeeTypeGroup: boolean
          isCustomerOrgGroup: boolean
          isCustomerTypeGroup: boolean
          isSupplierOrgGroup: boolean
          isSupplierTypeGroup: boolean
          users: Json
        }[]
      }
      has_any_company_permission: {
        Args: {
          claim: string
        }
        Returns: boolean
      }
      has_company_permission: {
        Args: {
          claim: string
          company: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          required_role: string
          company: string
        }
        Returns: boolean
      }
      has_valid_api_key_for_company: {
        Args: {
          company: string
        }
        Returns: boolean
      }
      is_claims_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      journalLinesByAccountNumber: {
        Args: {
          from_date?: string
          to_date?: string
        }
        Returns: {
          number: string
          companyId: string
          balance: number
          balanceAtDate: number
          netChange: number
        }[]
      }
      jsonb_to_text_array: {
        Args: {
          "": Json
        }
        Returns: string[]
      }
      users_for_groups: {
        Args: {
          groups: string[]
        }
        Returns: Json
      }
      xid: {
        Args: {
          _at?: string
        }
        Returns: unknown
      }
      xid_counter: {
        Args: {
          _xid: unknown
        }
        Returns: number
      }
      xid_decode: {
        Args: {
          _xid: unknown
        }
        Returns: number[]
      }
      xid_encode: {
        Args: {
          _id: number[]
        }
        Returns: unknown
      }
      xid_machine: {
        Args: {
          _xid: unknown
        }
        Returns: number[]
      }
      xid_pid: {
        Args: {
          _xid: unknown
        }
        Returns: number
      }
      xid_time: {
        Args: {
          _xid: unknown
        }
        Returns: string
      }
    }
    Enums: {
      accountingPeriodStatus: "Inactive" | "Active"
      costLedgerType:
        | "Direct Cost"
        | "Revaluation"
        | "Rounding"
        | "Indirect Cost"
        | "Variance"
        | "Total"
      deadlineType: "No Deadline" | "ASAP" | "Soft Deadline" | "Hard Deadline"
      documentSourceType:
        | "Job"
        | "Part"
        | "Purchase Order"
        | "Purchase Invoice"
        | "Purchase Return Order"
        | "Quote"
        | "Receipt"
        | "Request for Quote"
        | "Sales Order"
        | "Sales Invoice"
        | "Sales Return Order"
        | "Service"
        | "Shipment"
        | "Material"
        | "Tool"
        | "Fixture"
        | "Consumable"
      documentTransactionType:
        | "Download"
        | "Edit"
        | "Favorite"
        | "Label"
        | "Unfavorite"
        | "Upload"
      documentType:
        | "Archive"
        | "Document"
        | "Presentation"
        | "PDF"
        | "Spreadsheet"
        | "Text"
        | "Image"
        | "Video"
        | "Audio"
        | "Other"
      factor:
        | "Hours/Piece"
        | "Hours/100 Pieces"
        | "Hours/1000 Pieces"
        | "Minutes/Piece"
        | "Minutes/100 Pieces"
        | "Minutes/1000 Pieces"
        | "Pieces/Hour"
        | "Pieces/Minute"
        | "Seconds/Piece"
        | "Total Hours"
        | "Total Minutes"
      glAccountCategory:
        | "Bank"
        | "Accounts Receivable"
        | "Inventory"
        | "Other Current Asset"
        | "Fixed Asset"
        | "Accumulated Depreciation"
        | "Other Asset"
        | "Accounts Payable"
        | "Other Current Liability"
        | "Long Term Liability"
        | "Equity - No Close"
        | "Equity - Close"
        | "Retained Earnings"
        | "Income"
        | "Cost of Goods Sold"
        | "Expense"
        | "Other Income"
        | "Other Expense"
      glAccountClass: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense"
      glAccountType: "Posting" | "Total" | "Begin Total" | "End Total"
      glConsolidatedRate: "Average" | "Current" | "Historical"
      glIncomeBalance: "Balance Sheet" | "Income Statement"
      itemCostingMethod: "Standard" | "Average" | "LIFO" | "FIFO"
      itemLedgerDocumentType:
        | "Sales Shipment"
        | "Sales Invoice"
        | "Sales Return Receipt"
        | "Sales Credit Memo"
        | "Purchase Receipt"
        | "Purchase Invoice"
        | "Purchase Return Shipment"
        | "Purchase Credit Memo"
        | "Transfer Shipment"
        | "Transfer Receipt"
        | "Service Shipment"
        | "Service Invoice"
        | "Service Credit Memo"
        | "Posted Assembly"
        | "Inventory Receipt"
        | "Inventory Shipment"
        | "Direct Transfer"
      itemLedgerType:
        | "Purchase"
        | "Sale"
        | "Positive Adjmt."
        | "Negative Adjmt."
        | "Transfer"
        | "Consumption"
        | "Output"
        | "Assembly Consumption"
        | "Assembly Output"
      itemReorderingPolicy:
        | "Manual Reorder"
        | "Demand-Based Reorder"
        | "Fixed Reorder Quantity"
        | "Maximum Quantity"
      itemReplenishmentSystem: "Buy" | "Make" | "Buy and Make"
      itemTrackingType: "Inventory" | "Non-Inventory"
      itemType:
        | "Part"
        | "Material"
        | "Tool"
        | "Service"
        | "Consumable"
        | "Fixture"
      jobOperationStatus:
        | "Canceled"
        | "Done"
        | "In Progress"
        | "Paused"
        | "Ready"
        | "Todo"
        | "Waiting"
      jobStatus:
        | "Draft"
        | "Ready"
        | "In Progress"
        | "Paused"
        | "Completed"
        | "Cancelled"
      journalLineDocumentType:
        | "Receipt"
        | "Invoice"
        | "Credit Memo"
        | "Blanket Order"
        | "Return Order"
      methodOperationOrder: "After Previous" | "With Previous"
      methodType: "Buy" | "Make" | "Pick"
      module:
        | "Accounting"
        | "Documents"
        | "Invoicing"
        | "Inventory"
        | "Items"
        | "Messaging"
        | "Parts"
        | "People"
        | "Production"
        | "Purchasing"
        | "Resources"
        | "Sales"
        | "Settings"
        | "Users"
      month:
        | "January"
        | "February"
        | "March"
        | "April"
        | "May"
        | "June"
        | "July"
        | "August"
        | "September"
        | "October"
        | "November"
        | "December"
      operationType: "Inside" | "Outside"
      payableLineType:
        | "Comment"
        | "G/L Account"
        | "Fixed Asset"
        | "Part"
        | "Material"
        | "Tool"
        | "Service"
        | "Consumable"
        | "Fixture"
      paymentTermCalculationMethod: "Net" | "End of Month" | "Day of Month"
      processType: "Inside" | "Outside" | "Inside and Outside"
      productionEventType: "Setup" | "Labor" | "Machine"
      purchaseInvoiceStatus:
        | "Draft"
        | "Pending"
        | "Submitted"
        | "Return"
        | "Debit Note Issued"
        | "Paid"
        | "Partially Paid"
        | "Overdue"
        | "Voided"
      purchaseOrderLineType:
        | "Comment"
        | "G/L Account"
        | "Fixed Asset"
        | "Part"
        | "Material"
        | "Tool"
        | "Service"
        | "Consumable"
        | "Fixture"
      purchaseOrderStatus:
        | "Draft"
        | "To Review"
        | "Rejected"
        | "To Receive"
        | "To Receive and Invoice"
        | "To Invoice"
        | "Completed"
        | "Closed"
      purchaseOrderTransactionType:
        | "Edit"
        | "Favorite"
        | "Unfavorite"
        | "Approved"
        | "Reject"
        | "Request Approval"
      purchaseOrderType: "Purchase" | "Return"
      quoteLineStatus: "Not Started" | "In Progress" | "Complete" | "No Quote"
      quoteStatus:
        | "Draft"
        | "Sent"
        | "Ordered"
        | "Partial"
        | "Lost"
        | "Cancelled"
        | "Expired"
      receiptSourceDocument:
        | "Sales Order"
        | "Sales Invoice"
        | "Sales Return Order"
        | "Purchase Order"
        | "Purchase Invoice"
        | "Purchase Return Order"
        | "Inbound Transfer"
        | "Outbound Transfer"
        | "Manufacturing Consumption"
        | "Manufacturing Output"
      receiptStatus: "Draft" | "Pending" | "Posted"
      role: "customer" | "employee" | "supplier"
      salesOrderLineStatus: "Ordered" | "In Progress" | "Completed"
      salesOrderLineType:
        | "Comment"
        | "Part"
        | "Material"
        | "Tool"
        | "Service"
        | "Consumable"
        | "Fixture"
        | "Fixed Asset"
      salesOrderStatus:
        | "Draft"
        | "Needs Approval"
        | "Confirmed"
        | "In Progress"
        | "Completed"
        | "Invoiced"
        | "Cancelled"
        | "Closed"
      salesOrderTransactionType:
        | "Edit"
        | "Favorite"
        | "Unfavorite"
        | "Approved"
        | "Reject"
        | "Request Approval"
      salesRfqStatus: "Draft" | "Ready for Quote" | "Closed" | "Quoted"
      searchEntity:
        | "Resource"
        | "Person"
        | "Customer"
        | "Supplier"
        | "Job"
        | "Part"
        | "Purchase Order"
        | "Lead"
        | "Opportunity"
        | "Quotation"
        | "Sales Order"
        | "Request for Quotation"
        | "Sales Invoice"
        | "Purchase Invoice"
        | "Document"
        | "Sales RFQ"
      serviceType: "Internal" | "External"
      shippingCarrier: "UPS" | "FedEx" | "USPS" | "DHL" | "Other"
      supplierLedgerDocumentType:
        | "Payment"
        | "Invoice"
        | "Credit Memo"
        | "Finance Charge Memo"
        | "Reminder"
        | "Refund"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string
          name: string
          owner: string
          metadata: Json
        }
        Returns: undefined
      }
      extension: {
        Args: {
          name: string
        }
        Returns: string
      }
      filename: {
        Args: {
          name: string
        }
        Returns: string
      }
      foldername: {
        Args: {
          name: string
        }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          size: number
          bucket_id: string
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
        }
        Returns: {
          key: string
          id: string
          created_at: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          start_after?: string
          next_token?: string
        }
        Returns: {
          name: string
          id: string
          metadata: Json
          updated_at: string
        }[]
      }
      search: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

