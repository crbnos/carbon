export const STRIPE_CONNECT_ACCOUNT_CONFIG = {
  dashboard: "express",
  entityType: "company",
  capabilities: { ach_debit_payments: true, card_payments: true },
  responsibilities: {
    feesCollector: "application_express",
    lossesCollector: "application"
  }
} as const;
