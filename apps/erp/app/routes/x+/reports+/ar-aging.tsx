// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  getAgingParams,
  getAgingUnappliedPayments,
  getArAging,
  getArOpenByCustomer,
  getArTieOut
} from "~/modules/invoicing/invoicing.service";
import { ARAPWorkbench } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`AR Aging`,
  to: path.to.arAging
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(request, {
    "accounting.reporting": "View"
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

  const [tieOut, aging, open, payments] = await Promise.all([
    accountingSetUp
      ? getArTieOut(client, companyId, asOfDate)
      : Promise.resolve({ data: null }),
    getArAging(client, companyId, asOfDate, { agingMethod, bucketDays }),
    getArOpenByCustomer(client, companyId, asOfDate),
    getAgingUnappliedPayments(client, companyId, asOfDate, "ar")
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
    })),
    payments: (payments.data ?? []).map((r) => ({
      ...r,
      paymentId: r.documentId,
      paymentNumber: r.documentNumber,
      paymentType: r.documentType,
      customerId: r.partyId
    }))
  };
}

export default function ArAgingRoute() {
  const { asOfDate, agingMethod, bucketDays, result, aging, open, payments } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  return (
    <ARAPWorkbench
      side="ar"
      result={result}
      aging={aging}
      open={open}
      payments={payments}
      reportDetails
      asOfDate={asOfDate}
      agingMethod={agingMethod}
      bucketDays={bucketDays}
      title={t`AR Aging`}
    />
  );
}
