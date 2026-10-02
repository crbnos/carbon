// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const STRIPE_CONNECT_ACCOUNT_CONFIG = {
  dashboard: "express",
  entityType: "company",
  capabilities: { ach_debit_payments: true, card_payments: true },
  responsibilities: {
    feesCollector: "application_express",
    lossesCollector: "application"
  }
} as const;
