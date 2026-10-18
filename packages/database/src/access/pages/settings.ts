// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

// The pages that configure a module (Settings → Inventory and the others) stay
// Settings pages. Each writes its own columns of the one companySettings row,
// which Company owns. Company also owns the company-wide records no sidebar
// entry manages: the tag list every page adds to, and the Implementation Hub.
export const SETTINGS_PAGES = [
  {
    id: "settings.billing",
    label: "Billing",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/billing"]
  },
  {
    id: "settings.company",
    label: "Company",
    maxLevel: "Full",
    tables: [
      "company",
      "companySettings",
      "companyAccountsPayableBillingAddress",
      "companyAccountsReceivableBillingAddress",
      "tag",
      "implementationHub",
      "implementationCheckState",
      "implementationFieldValue"
    ],
    paths: ["/x/settings/company"]
  },
  {
    id: "settings.companies",
    label: "Companies",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/companies"]
  },
  {
    id: "settings.documentTemplates",
    label: "Document Templates",
    maxLevel: "Full",
    tables: ["documentTemplate", "documentSection", "terms"],
    paths: ["/x/templates"]
  },
  {
    id: "settings.logos",
    label: "Logos",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/logos"]
  },
  {
    id: "settings.printing",
    label: "Printing",
    maxLevel: "Full",
    tables: ["printerRoute", "printJob"],
    paths: ["/x/settings/printing"]
  },
  {
    id: "settings.accounting",
    label: "Accounting",
    maxLevel: "Full",
    tables: ["accountingCutoverIgnoredInvoice"],
    paths: ["/x/settings/accounting", "/x/accounting/activation"]
  },
  {
    id: "settings.inventory",
    label: "Inventory",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/inventory"]
  },
  {
    id: "settings.invoicing",
    label: "Invoicing",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/invoicing"]
  },
  {
    id: "settings.items",
    label: "Items",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/items"]
  },
  {
    id: "settings.people",
    label: "People",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/people"]
  },
  {
    id: "settings.planning",
    label: "Planning",
    maxLevel: "Full",
    tables: ["itemPostingGroupResponsibility"],
    paths: ["/x/settings/planning"]
  },
  {
    id: "settings.purchasing",
    label: "Purchasing",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/purchasing"]
  },
  {
    id: "settings.production",
    label: "Production",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/production"]
  },
  {
    id: "settings.quality",
    label: "Quality",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/quality"]
  },
  {
    id: "settings.sales",
    label: "Sales",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/sales"]
  },
  {
    id: "settings.resources",
    label: "Resources",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/resources"]
  },
  {
    id: "settings.apiKeys",
    label: "API Keys",
    maxLevel: "Full",
    tables: ["apiKey", "apiKeyRateLimit", "permission"],
    where: { table: "permission", column: "apiKeyId" },
    paths: ["/x/settings/api-keys"]
  },
  {
    id: "settings.approvalRules",
    label: "Approval Rules",
    maxLevel: "Full",
    tables: ["approvalRule"],
    paths: ["/x/settings/approval-rules"]
  },
  {
    id: "settings.auditLogs",
    label: "Audit Logs",
    maxLevel: "Edit",
    tables: [],
    paths: ["/x/settings/audit-logs"]
  },
  {
    id: "settings.backups",
    label: "Backups",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/backups"]
  },
  {
    id: "settings.customFields",
    label: "Custom Fields",
    maxLevel: "Full",
    tables: ["customField"],
    paths: ["/x/settings/custom-fields"]
  },
  {
    id: "settings.demoData",
    label: "Demo Data",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/settings/demo-data"]
  },
  {
    id: "settings.integrations",
    label: "Integrations",
    maxLevel: "Full",
    tables: ["companyIntegration", "accountingSyncOperation"],
    paths: ["/x/settings/integrations"]
  },
  {
    id: "settings.itarCertifications",
    label: "ITAR Certifications",
    maxLevel: "View",
    tables: [],
    paths: ["/x/settings/itar-certifications"]
  },
  {
    id: "settings.security",
    label: "Security",
    maxLevel: "Full",
    tables: ["ssoConnection", "ssoDomain"],
    paths: ["/x/settings/security", "/x/settings/sso"]
  },
  {
    id: "settings.sequences",
    label: "Sequences",
    maxLevel: "Full",
    tables: ["sequence"],
    paths: ["/x/settings/sequences"]
  },
  {
    id: "settings.serialNumbers",
    label: "Serial Numbers",
    maxLevel: "Full",
    tables: ["itemSerialSequence"],
    paths: ["/x/settings/serial-numbers"]
  },
  {
    id: "settings.webhooks",
    label: "Webhooks",
    maxLevel: "Full",
    tables: ["webhook"],
    paths: ["/x/settings/webhooks"]
  }
] as const satisfies readonly Page[];
