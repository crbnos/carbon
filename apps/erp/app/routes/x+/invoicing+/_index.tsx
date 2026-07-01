import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import type { AgingTotals, RecentPayment } from "~/modules/invoicing";
import {
  getApAging,
  getApTieOut,
  getArAging,
  getArTieOut,
  getPayments,
  InvoicingDashboard
} from "~/modules/invoicing";
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
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const asOfDate = new Date().toISOString().slice(0, 10);
  const { sorts, filters } = getGenericQueryFilters(new URLSearchParams());

  const [arAging, apAging, arTieOut, apTieOut, payments] = await Promise.all([
    getArAging(client, companyId, asOfDate, { bucketDays: BUCKET_DAYS }),
    getApAging(client, companyId, asOfDate, { bucketDays: BUCKET_DAYS }),
    getArTieOut(client, companyId, asOfDate),
    getApTieOut(client, companyId, asOfDate),
    getPayments(client, companyId, {
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
    ar: sumAging((arAging.data ?? []) as AgingRow[]),
    ap: sumAging((apAging.data ?? []) as AgingRow[]),
    arTieOut: arTieOut.data ?? null,
    apTieOut: apTieOut.data ?? null,
    recentPayments: (payments.data ?? []) as unknown as RecentPayment[]
  };
}

export default function InvoicingIndexRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <InvoicingDashboard
      asOfDate={data.asOfDate}
      bucketDays={data.bucketDays}
      ar={data.ar}
      ap={data.ap}
      arTieOut={data.arTieOut}
      apTieOut={data.apTieOut}
      recentPayments={data.recentPayments}
    />
  );
}
