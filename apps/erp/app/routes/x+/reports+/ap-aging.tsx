// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  getApAging,
  getApOpenBySupplier,
  getApTieOut
} from "~/modules/invoicing/invoicing.service";
import { ARAPWorkbench } from "~/modules/invoicing/ui";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { resolveApAgingRequest } from "./ap-aging.server";

export const handle: Handle = {
  breadcrumb: msg`AP Aging`,
  to: path.to.apAging
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, asOfDate, agingMethod, bucketDays } =
    await resolveApAgingRequest(request);

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

export default function ApAgingRoute() {
  const { asOfDate, agingMethod, bucketDays, result, aging, open } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  return (
    <ARAPWorkbench
      side="ap"
      result={result}
      aging={aging}
      open={open}
      asOfDate={asOfDate}
      agingMethod={agingMethod}
      bucketDays={bucketDays}
      title={t`AP Aging`}
    />
  );
}
