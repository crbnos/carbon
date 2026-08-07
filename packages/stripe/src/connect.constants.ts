export const STRIPE_CONNECT_ACCOUNT_CONFIG = {
  dashboard: "express",
  entityType: "company",
  capabilities: ["card_payments"], // TODO: Confirm w Chase
  responsibilities: {
    feesCollector: "application_express",
    lossesCollector: "application"
  }
} as const;
