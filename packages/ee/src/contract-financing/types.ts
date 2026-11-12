// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";

// Row types derive from the generated database types only. This file never
// imports a server file, so the client-safe barrel stays out of the server
// graph (commercial-licensing.md, "Bundling gotcha").

type Tables = Database["public"]["Tables"];

export type CustomerContractFinancing =
  Tables["customerContractFinancing"]["Row"];
export type CustomerContractFinancingRate =
  Tables["customerContractFinancingRate"]["Row"];
export type ContractFinancingRequest =
  Tables["contractFinancingRequest"]["Row"];
export type PerformanceBasedPaymentEvent =
  Tables["performanceBasedPaymentEvent"]["Row"];

/** An override of one SF 1443 line, as `contractFinancingRequest.overrides` stores it. */
export type FinancingOverride = {
  value: number;
  reason: string;
  by: string;
  at: string;
};

/** Everything the contract's Financing section shows. */
export type ContractFinancingView = {
  terms: CustomerContractFinancing | null;
  rates: CustomerContractFinancingRate[];
  events: (PerformanceBasedPaymentEvent & { billed: boolean })[];
  requests: (ContractFinancingRequest & {
    paymentReadableId: string | null;
    paymentStatus: string | null;
  })[];
  /** Contract deposits received less what invoices have liquidated. */
  unliquidated: number;
  currencyCode: string;
  /** The contract's currency is the company's base currency. */
  isBaseCurrency: boolean;
};
