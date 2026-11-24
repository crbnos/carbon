// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  getAgingParams,
  getApPendingPayments
} from "~/modules/invoicing/invoicing.service";
import { ARAPWorkbench } from "~/modules/invoicing/ui";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["purchaseInvoice", "payment"],
  breadcrumb: msg`Payables`,
  to: path.to.payables
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(request, {
    "invoicing.payables": "View"
  });

  const { asOfDate, agingMethod, bucketDays } = await getAgingParams(
    client,
    companyId,
    request
  );

  // GL tie-outs only mean something once journals count — skip them
  // entirely before the accounting cutover (result: null hides the
  // tie-out panel and the adjusting-entry form in ARAPWorkbench).
  const companySettings = await api.settings.getCompanySettings({});
  const accountingSetUp = hasAccountingCutover(companySettings.data);

  const [tieOut, aging, open, pending] = await Promise.all([
    accountingSetUp
      ? api.invoicing.getApTieOut({ asOfDate })
      : Promise.resolve({ data: null }),
    api.invoicing.getApAging({
      asOfDate,
      options: { agingMethod, bucketDays }
    }),
    api.invoicing.getApOpenBySupplier({ asOfDate }),
    getApPendingPayments(getDatabaseClient(), companyId)
  ]);

  return {
    asOfDate,
    agingMethod,
    bucketDays,
    result: tieOut.data ?? null,
    aging: aging.data ?? [],
    pending: Object.fromEntries(pending),
    open: (open.data ?? []).map((r) => ({
      ...r,
      invoiceId: r.documentId,
      invoiceNumber: r.documentNumber
    }))
  };
}

export default function PayablesRoute() {
  const { asOfDate, agingMethod, bucketDays, result, aging, open, pending } =
    useLoaderData<typeof loader>();
  return (
    <ARAPWorkbench
      side="ap"
      result={result}
      aging={aging}
      open={open}
      pending={pending}
      asOfDate={asOfDate}
      agingMethod={agingMethod}
      bucketDays={bucketDays}
    />
  );
}
