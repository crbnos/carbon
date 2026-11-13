// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Carbon takes direct charges and no application fee, so the seller pays
// Stripe's fees and Stripe carries negative balances. Stripe allows that only
// with the full Stripe Dashboard: an Express dashboard requires the platform to
// collect fees and carry losses. Stripe fixes all three when it creates the
// account, so a change here applies only to accounts created after it.
export const STRIPE_CONNECT_ACCOUNT_CONFIG = {
  dashboard: "full",
  entityType: "company",
  capabilities: { ach_debit_payments: true, card_payments: true },
  responsibilities: {
    feesCollector: "stripe",
    lossesCollector: "stripe"
  }
} as const;
