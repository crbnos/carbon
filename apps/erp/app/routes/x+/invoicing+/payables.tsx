import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  ARAPWorkbench,
  getApAging,
  getApOpenBySupplier,
  getApTieOut
} from "~/modules/invoicing";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Payables",
  to: path.to.payables,
  module: "invoicing"
};

function parseBuckets(raw: string | null): [number, number, number] {
  const parts = (raw ?? "").split(",").map((n) => Number.parseInt(n, 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return [parts[0], parts[1], parts[2]];
  }
  return [30, 60, 90];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);
  const agingMethod: "dueDate" | "documentDate" =
    url.searchParams.get("agingMethod") === "documentDate"
      ? "documentDate"
      : "dueDate";
  const bucketDays = parseBuckets(url.searchParams.get("bucketDays"));

  // GL tie-outs only mean something when journals are being posted — skip
  // them entirely when accounting is disabled (result: null hides the
  // tie-out panel and the adjusting-entry form in ARAPWorkbench).
  const companySettings = await getCompanySettings(client, companyId);
  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;

  const [tieOut, aging, open] = await Promise.all([
    accountingEnabled
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
