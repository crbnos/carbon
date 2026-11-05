// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  getAgingParams,
  getApAging,
  getApOpenBySupplier,
  getApTieOut
} from "~/modules/invoicing/invoicing.service";
import { ARAPWorkbench } from "~/modules/invoicing/ui";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["purchaseInvoice", "payment"],
  breadcrumb: msg`Payables`,
  to: path.to.payables,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { asOfDate, agingMethod, bucketDays } = await getAgingParams(
    client,
    companyId,
    request
  );

  // GL tie-outs only mean something once journals count — skip them
  // entirely before the accounting cutover (result: null hides the
  // tie-out panel and the adjusting-entry form in ARAPWorkbench).
  const companySettings = await getCompanySettings(client, companyId);
  const accountingSetUp = hasAccountingCutover(companySettings.data);

  const [tieOut, aging, open] = await Promise.all([
    accountingSetUp
      ? getApTieOut(client, companyId, asOfDate)
      : Promise.resolve({ data: null }),
    getApAging(client, companyId, asOfDate, { agingMethod, bucketDays }),
    getApOpenBySupplier(client, companyId, asOfDate)
  ]);

  return {
    asOfDate,
    agingMethod,
    bucketDays,
    result: tieOut.data ?? null,
    aging: aging.data ?? [],
    open: (open.data ?? []).map((r) => ({
      ...r,
      invoiceId: r.documentId,
      invoiceNumber: r.documentNumber
    }))
  };
}

export default function PayablesRoute() {
  const { asOfDate, agingMethod, bucketDays, result, aging, open } =
    useLoaderData<typeof loader>();
  return (
    <ARAPWorkbench
      side="ap"
      result={result}
      aging={aging}
      open={open}
      asOfDate={asOfDate}
      agingMethod={agingMethod}
      bucketDays={bucketDays}
    />
  );
}
