// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import type { ContractRevenueRow } from "@carbon/utils";
import {
  contractPositionPreview,
  datetime,
  horizon,
  lineRevenueDates,
  lineTotals,
  planInvoiceSchedule,
  planRevenueSchedule,
  redirect,
  revenuePreview,
  round,
  validateRevenueEdit,
  validateScheduleEdit
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { useLoaderData, useMatches, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getContract,
  getContractAmendments,
  getContractInvoiceSchedule,
  getContractLines
} from "~/modules/sales";
import type {
  Contract,
  ContractCreditMemoLinks,
  ContractInvoiceLinks,
  ContractRouteData
} from "~/modules/sales/ui/Contracts";
import {
  ContractExplorer,
  ContractHeader,
  ContractProperties,
  scheduleRows,
  toContractLineTerms,
  toContractTerms
} from "~/modules/sales/ui/Contracts";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Service Contracts`, to: path.to.contracts },
    (data) => data?.contract?.customerContractId
  ),
  module: "sales"
};

// An amend / cancel preview posts but commits nothing, so it never refreshes
// the page; every other submission and navigation does.
export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  args.formData?.get("intent") === "preview"
    ? false
    : args.defaultShouldRevalidate;

export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<ContractRouteData> {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [contract, lines, schedule, amendments, storedRevenue, timeZone] =
    await Promise.all([
      getContract(client, id),
      getContractLines(client, id),
      getContractInvoiceSchedule(client, id),
      getContractAmendments(client, id),
      client
        .from("customerContractRevenue")
        .select(
          "customerContractLineId, periodStart, periodEnd, amount, status"
        )
        .eq("customerContractId", id)
        .eq("companyId", companyId)
        .order("periodStart", { ascending: true }),
      getCompanyTimeZone(client, companyId)
    ]);

  if (contract.error || !contract.data) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(contract.error, "Failed to load contract"))
    );
  }
  if (contract.data.companyId !== companyId) {
    throw redirect(path.to.contracts);
  }
  // NOT NULL on the table; the view types it nullable.
  const { currencyCode } = contract.data;
  if (!currencyCode) {
    logger.error("Contract has no currency", { companyId, id });
    throw redirect(
      path.to.contracts,
      await flash(request, error(null, "Failed to load contract"))
    );
  }
  const current: Contract = { ...contract.data, currencyCode };
  if (
    lines.error ||
    schedule.error ||
    amendments.error ||
    storedRevenue.error
  ) {
    throw redirect(
      path.to.contracts,
      await flash(
        request,
        error(
          lines.error ??
            schedule.error ??
            amendments.error ??
            storedRevenue.error,
          "Failed to load contract"
        )
      )
    );
  }

  const contractLines = lines.data ?? [];
  const invoices = schedule.data?.invoices ?? [];
  const credits = schedule.data?.credits ?? [];
  const isDraft = current.status === "Draft";
  const today = datetime.today(timeZone).toString();

  // Plan decision 2: an unedited Draft's schedule is never stored — it is
  // planned live from the lines, so a line edited anywhere (MCP included)
  // can never leave a stale schedule behind. The first edit, or Confirm,
  // persists it.
  const terms = toContractTerms(current);
  const lineTerms = contractLines.map(toContractLineTerms);
  const canPlan = !!terms.startDate;
  const planned =
    isDraft && canPlan
      ? planInvoiceSchedule(terms, lineTerms, horizon(terms, today))
      : null;
  const computedSchedule = isDraft && invoices.length === 0 ? planned : null;

  // What each line computes to across the live plan — the total the invoice
  // grid's columns must add up to, and the setup wizard's contract total.
  const plannedTotals: Record<string, number> = {};
  if (planned) {
    for (const [lineId, total] of lineTotals(planned)) {
      plannedTotals[lineId] = total;
    }
  }

  // An edited Draft whose lines changed since: what each line is short (or
  // over) against what the lines now compute. Non-zero offers Reset schedule.
  const residuals: Record<string, number> = {};
  if (isDraft && invoices.length > 0 && planned) {
    const check = validateScheduleEdit(
      lineTotals(planned),
      invoices.flatMap((invoice) =>
        invoice.customerContractInvoiceLine.map((row) => ({
          lineId: row.customerContractLineId,
          amount: Number(row.amount),
          isAdjustment: row.isAdjustment
        }))
      )
    );
    for (const [lineId, residual] of check.residuals) {
      residuals[lineId] = residual;
    }
  }

  // The drafted sales invoices (links, Held badges) and the credit memos of
  // the schedule — one `.in()` each, through the stamped ids.
  const salesInvoiceIds = [
    ...new Set(
      invoices.flatMap((invoice) =>
        invoice.salesInvoiceId ? [invoice.salesInvoiceId] : []
      )
    )
  ];
  const memoIds = [
    ...new Set(credits.flatMap((row) => (row.memoId ? [row.memoId] : [])))
  ];
  const [salesInvoices, memos] = await Promise.all([
    salesInvoiceIds.length > 0
      ? client
          .from("salesInvoice")
          .select("id, invoiceId, status, automationHoldReason")
          .eq("companyId", companyId)
          .in("id", salesInvoiceIds)
      : Promise.resolve({ data: [], error: null }),
    memoIds.length > 0
      ? client
          .from("memo")
          .select("id, memoId, status")
          .eq("companyId", companyId)
          .in("id", memoIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (salesInvoices.error || memos.error) {
    throw redirect(
      path.to.contracts,
      await flash(
        request,
        error(salesInvoices.error ?? memos.error, "Failed to load contract")
      )
    );
  }
  const invoiceLinks: ContractInvoiceLinks = {};
  for (const invoice of salesInvoices.data ?? []) {
    invoiceLinks[invoice.id] = invoice;
  }
  const creditMemoLinks: ContractCreditMemoLinks = {};
  for (const memo of memos.data ?? []) {
    creditMemoLinks[memo.id] = memo;
  }

  // Revenue preview (plan decision 1): each line's scheduled total spread
  // over its revenue dates, and the month-by-month position that follows.
  const rows = scheduleRows({ computedSchedule, schedule: invoices, credits });
  const netByLine = new Map<string, number>();
  const lastPeriodEndByLine = new Map<string, string>();
  for (const row of rows) {
    netByLine.set(row.lineId, (netByLine.get(row.lineId) ?? 0) + row.amount);
    const last = lastPeriodEndByLine.get(row.lineId);
    if (!last || row.periodEnd > last) {
      lastPeriodEndByLine.set(row.lineId, row.periodEnd);
    }
  }
  // A preview is a view, not a write: a line it cannot spread is logged and
  // left out, rather than taking the whole contract page down with a 500.
  let revenueLines: ReturnType<typeof revenuePreview> = [];
  try {
    revenueLines = contractLines.flatMap((line) => {
      const dates = lineRevenueDates(line);
      // A Recurring line with no end (open-ended, or running to the contract's
      // end) earns over the periods the schedule bills it for — not all at once,
      // which is what a missing end means for a One-time line.
      const revenueEnd =
        dates.end ??
        (line.revenueType === "Recurring"
          ? (lastPeriodEndByLine.get(line.id) ?? null)
          : null);
      return revenuePreview({
        id: line.id,
        revenueType: line.revenueType,
        method: line.revenueMethod,
        revenueStart: dates.start,
        revenueEnd,
        netAmount: round(netByLine.get(line.id) ?? 0)
      });
    });
  } catch (err) {
    logger.error("Failed to preview the contract's revenue", {
      companyId,
      customerContractId: id,
      error: err
    });
  }
  const position = contractPositionPreview(
    rows.map((row) => ({ invoiceDate: row.invoiceDate, amount: row.amount })),
    revenueLines
  );

  // The revenue plan (plan D1): the stored rows once a revenue edit or
  // Confirm has written them, else planned live from what each line bills —
  // the same way the server function would store it.
  const billedTotals = new Map(
    [...netByLine].map(([lineId, net]) => [lineId, round(net)])
  );
  const revenueIsStored = (storedRevenue.data ?? []).length > 0;
  const revenueRows: ContractRevenueRow[] = revenueIsStored
    ? (storedRevenue.data ?? []).map((row) => ({
        lineId: row.customerContractLineId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        amount: Number(row.amount),
        status: row.status
      }))
    : planRevenueSchedule({
        lines: contractLines.map((line) => ({
          id: line.id,
          revenueType: line.revenueType,
          revenueMethod: line.revenueMethod,
          startDate: line.startDate,
          endDate: line.endDate,
          goLiveDate: line.goLiveDate,
          revenueStartDate: line.revenueStartDate,
          revenueEndDate: line.revenueEndDate
        })),
        totals: billedTotals,
        fallbackEnds: lastPeriodEndByLine,
        recognizeRevenueFrom: current.recognizeRevenueFrom
      });
  // Per line: billed − Σ revenue. Non-zero blocks Confirm.
  const revenueResiduals: Record<string, number> = {};
  for (const [lineId, residual] of validateRevenueEdit(
    billedTotals,
    revenueRows
  ).residuals) {
    revenueResiduals[lineId] = residual;
  }

  return {
    contract: current,
    lines: contractLines,
    schedule: invoices,
    credits,
    amendments: amendments.data ?? [],
    computedSchedule,
    residuals,
    invoiceLinks,
    creditMemoLinks,
    revenue: { lines: revenueLines, position },
    lineTotals: plannedTotals,
    revenueRows,
    revenueIsStored,
    revenueResiduals
  };
}

export default function ContractRoute() {
  const { contract, lines } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const matches = useMatches();
  if (!id) throw new Error("Could not find id");

  // The setup wizard (`$id.setup`) is a child of this route so it reads the
  // same loader, but it takes the whole page rather than the workspace.
  if (matches.some((match) => match.id.endsWith("$id.setup"))) {
    return <RecordOutlet />;
  }

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <ContractHeader contract={contract} lines={lines} />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<ContractExplorer key={id} />}
              content={
                <div className="bg-muted dark:bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<ContractProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
