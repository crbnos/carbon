// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { XERO_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";

const coerceBoolean = z.preprocess(
  (v) =>
    v === "true" || v === "on" ? true : v === "false" || v === "" ? false : v,
  z.boolean()
);

const XeroSettingsSchema = z.object({
  backfillCustomers: coerceBoolean.optional().default(true),
  backfillVendors: coerceBoolean.optional().default(true),
  backfillItems: coerceBoolean.optional().default(true)
});

export const Xero = defineIntegration({
  name: "Xero",
  id: "xero",
  active: true,
  category: "Accounting",
  providerRole: "accounting" as const,
  logo: pieceLogo("xero"),
  description:
    "Integrating Carbon with Xero enables you to post transactions from sales invoices and purchase invoices into your existing accounting software, neatly organizing everything in your bookkeeping software.",
  shortDescription:
    "Automatically post transactions from sales and purchase invoices.",
  images: [],
  settings: [
    {
      name: "backfillCustomers",
      label: "Customers",
      description: "Include customers in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillVendors",
      label: "Vendors",
      description: "Include vendors/suppliers in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillItems",
      label: "Items",
      description: "Include items/products in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    }
  ],
  schema: XeroSettingsSchema,
  oauth: {
    authUrl: "https://login.xero.com/identity/connect/authorize",
    clientId: XERO_CLIENT_ID!,
    redirectUri: "/api/integrations/xero/oauth",
    // Granular scopes (Xero retired the broad `accounting.transactions` scope for
    // apps created after 2026-03-02; the granular set also works on older apps).
    // Overshoot the accounting-transaction family so no synced entity 403s:
    // invoices+bills → invoices, payments → payments, journal entries →
    // manualjournals, POs/quotes → invoices, chart/tax/items → settings.
    scopes: [
      "offline_access",
      "accounting.contacts",
      "accounting.settings",
      "accounting.invoices",
      "accounting.payments",
      "accounting.banktransactions",
      "accounting.manualjournals",
      // Read-only: the accounting activation wizard pulls the trial balance
      // as at the day before the cutover (GET /Reports/TrialBalance). A tenant
      // connected before this scope was added gets a 401/403 there, surfaced as
      // "reconnect the integration" — no forced reconnect.
      "accounting.reports.trialbalance.read"
    ],
    tokenUrl: "https://login.xero.com/identity/connect/token"
  },
  actions: [
    {
      id: "import-master-data",
      label: "Import customers & vendors",
      description:
        "Pull the customers and vendors already in Xero into Carbon and link them, so documents Carbon posts later reuse the original Xero records instead of creating duplicates",
      endpoint:
        "/api/integrations/master-sync?provider=xero&direction=pull-from-accounting&entities=customers,vendors"
    },
    {
      id: "push-master-data",
      label: "Push customers, vendors & items",
      description:
        "Send every Carbon record that has no Xero counterpart yet, for the entities selected above",
      endpoint:
        "/api/integrations/master-sync?provider=xero&direction=push-to-accounting"
    }
  ]
});
