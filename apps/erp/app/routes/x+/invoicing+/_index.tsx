// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { anyOf, pagesOf } from "@carbon/database/access";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import type { AgingTotals, RecentPayment } from "~/modules/invoicing/ui";
import { InvoicingDashboard } from "~/modules/invoicing/ui";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { getGenericQueryFilters } from "~/utils/query";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

// The four bucket boundaries the dashboard rolls aging into (Current, 1–30,
// 31–60, 61–90, 90+). Kept in sync with the aging report defaults.
const BUCKET_DAYS: [number, number, number] = [30, 60, 90];

type AgingRow = {
  current: number | null;
  bucket1: number | null;
  bucket2: number | null;
  bucket3: number | null;
  bucket4: number | null;
  unapplied: number | null;
  total: number | null;
};

function sumAging(rows: AgingRow[]): AgingTotals {
  const totals: AgingTotals = {
    current: 0,
    bucket1: 0,
    bucket2: 0,
    bucket3: 0,
    bucket4: 0,
    unapplied: 0,
    total: 0,
    count: 0
  };
  for (const r of rows) {
    totals.current += Number(r.current ?? 0);
    totals.bucket1 += Number(r.bucket1 ?? 0);
    totals.bucket2 += Number(r.bucket2 ?? 0);
    totals.bucket3 += Number(r.bucket3 ?? 0);
    totals.bucket4 += Number(r.bucket4 ?? 0);
    totals.unapplied += Number(r.unapplied ?? 0);
    totals.total += Number(r.total ?? 0);
    // Only count counterparties that actually carry an open balance.
    if (Number(r.total ?? 0) !== 0) totals.count += 1;
  }
  return totals;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(
    request,
    anyOf(pagesOf("invoicing"), "View")
  );

  const asOfDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const { sorts, filters } = getGenericQueryFilters(new URLSearchParams());

  // GL tie-outs only mean something once journals count — skip them
  // entirely before the accounting cutover.
  const companySettings = await api.settings.getCompanySettings({});
  const accountingSetUp = hasAccountingCutover(companySettings.data);

  const [arAging, apAging, arTieOut, apTieOut, payments] = await Promise.all([
    api.invoicing.getArAging({
      asOfDate,
      options: { bucketDays: BUCKET_DAYS }
    }),
    api.invoicing.getApAging({
      asOfDate,
      options: { bucketDays: BUCKET_DAYS }
    }),
    accountingSetUp
      ? api.invoicing.getArTieOut({ asOfDate })
      : Promise.resolve({ data: null }),
    accountingSetUp
      ? api.invoicing.getApTieOut({ asOfDate })
      : Promise.resolve({ data: null }),
    api.invoicing.getPayments({
      search: null,
      paymentType: null,
      status: null,
      customerId: null,
      supplierId: null,
      limit: 6,
      offset: 0,
      sorts,
      filters
    })
  ]);

  return {
    asOfDate,
    bucketDays: BUCKET_DAYS,
    accountingSetUp,
    ar: sumAging((arAging.data ?? []) as AgingRow[]),
    ap: sumAging((apAging.data ?? []) as AgingRow[]),
    arTieOut: arTieOut.data ?? null,
    apTieOut: apTieOut.data ?? null,
    recentPayments: (payments.data?.rows ?? []) as unknown as RecentPayment[]
  };
}

export default function InvoicingIndexRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <InvoicingDashboard
      asOfDate={data.asOfDate}
      bucketDays={data.bucketDays}
      accountingSetUp={data.accountingSetUp}
      ar={data.ar}
      ap={data.ap}
      arTieOut={data.arTieOut}
      apTieOut={data.apTieOut}
      recentPayments={data.recentPayments}
    />
  );
}
