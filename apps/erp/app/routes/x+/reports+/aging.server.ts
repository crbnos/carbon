// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The AR and AP aging CSV downloads. The same data is on screen for an
// invoicing viewer (the receivables/payables workbenches) and for an accounting
// viewer (the aging reports), so the download admits either; the page loaders
// keep their own, narrower, permission.

import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { resolveLanguage } from "@carbon/locale";
import { getPreferenceHeaders } from "@carbon/utils";
import { setupI18n } from "@lingui/core";
import {
  type AgingCsvLabels,
  agingCsvMessages
} from "~/modules/invoicing/invoicing.reports";
import { getAgingParams } from "~/modules/invoicing/invoicing.service";
import { getCatalog, preloadCatalog } from "~/services/lingui";

export async function resolveAgingExportRequest(request: Request) {
  const { client, companyId, permissions } = await requirePermissions(request, {
    role: "employee"
  });
  const canView = ["invoicing", "accounting"].some((module) =>
    hasPermission(permissions, module, "view", companyId)
  );
  if (!canView) throw new Response("Forbidden", { status: 403 });

  const params = await getAgingParams(client, companyId, request);
  // Party RLS requires sales/purchasing view, which an authorized aging viewer
  // need not have. Only the company-scoped name lookup uses this client.
  return { client, partyClient: getCarbonServiceRole(), companyId, ...params };
}

export async function getAgingCsvLabels(
  request: Request,
  party: "Customer" | "Supplier"
): Promise<AgingCsvLabels> {
  const language = resolveLanguage(getPreferenceHeaders(request).locale);
  await preloadCatalog(language);
  const i18n = setupI18n();
  i18n.load(language, getCatalog(language));
  i18n.activate(language);
  const translate = i18n._.bind(i18n);

  return {
    party: translate(
      party === "Customer"
        ? agingCsvMessages.customer
        : agingCsvMessages.supplier
    ),
    document: translate(agingCsvMessages.document),
    transactionDate: translate(agingCsvMessages.transactionDate),
    documentType: translate(agingCsvMessages.documentType),
    invoice: translate(agingCsvMessages.invoice),
    creditMemo: translate(agingCsvMessages.creditMemo),
    debitMemo: translate(agingCsvMessages.debitMemo),
    supplierInvoiceNumber: translate(agingCsvMessages.supplierInvoiceNumber),
    dueDate: translate(agingCsvMessages.dueDate),
    originalAmount: translate(agingCsvMessages.originalAmount),
    daysPastDue: translate(agingCsvMessages.daysPastDue),
    paymentTerm: translate(agingCsvMessages.paymentTerm),
    current: translate(agingCsvMessages.current),
    unapplied: translate(agingCsvMessages.unapplied),
    total: translate(agingCsvMessages.total)
  };
}

export function agingCsvResponse(
  filename: string,
  table: { fields: string[]; rows: unknown[][] }
) {
  return new Response(encodeCsvTable(table.fields, table.rows), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
