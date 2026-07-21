import { requirePermissions } from "@carbon/auth/auth.server";
import { data, type LoaderFunctionArgs } from "react-router";
import {
  paginateByAccountNumber,
  type TrialBalanceRpcRow,
  toTrialBalanceRow
} from "~/modules/accounting/accounting.integration";
import { trialBalanceQueryValidator } from "~/modules/accounting/accounting.models";
import {
  getBaseCurrency,
  getTrialBalance
} from "~/modules/accounting/accounting.service";

// GET /api/v1/accounting/trial-balance
// Trial balance (Posted journals only) keyed by stable accountNumber.
// bookId/dimension/groupBy are reserved (Phase 2) and rejected with 400 until
// the record-integrity book/dimension model lands.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting"
    }
  );

  const url = new URL(request.url);
  const parsed = trialBalanceQueryValidator.safeParse({
    periodId: url.searchParams.get("periodId") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    bookId: url.searchParams.get("bookId") ?? undefined,
    dimension: url.searchParams.getAll("dimension"),
    groupBy: url.searchParams.get("groupBy") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  if (!parsed.success) {
    return data(
      {
        error: "Invalid query",
        code: "INVALID_QUERY",
        details: parsed.error.issues
      },
      { status: 400 }
    );
  }

  const query = parsed.data;

  if (
    query.bookId ||
    (query.dimension && query.dimension.length > 0) ||
    query.groupBy
  ) {
    return data(
      {
        error:
          "bookId, dimension, and groupBy are not yet supported on this endpoint",
        code: "NOT_SUPPORTED"
      },
      { status: 400 }
    );
  }

  // Resolve the date range: a periodId wins, else the provided start/end.
  let startDate = query.startDate ?? null;
  let endDate = query.endDate ?? null;

  if (query.periodId) {
    const period = await client
      .from("accountingPeriod")
      .select("startDate, endDate")
      .eq("id", query.periodId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (period.error || !period.data) {
      return data(
        { error: "Accounting period not found", code: "PERIOD_NOT_FOUND" },
        { status: 404 }
      );
    }
    startDate = period.data.startDate;
    endDate = period.data.endDate;
  }

  const tb = await getTrialBalance(client, companyGroupId, companyId, {
    startDate,
    endDate
  });

  if (tb.error) {
    return data(
      { error: tb.error.message, code: "TRIAL_BALANCE_FAILED" },
      { status: 500 }
    );
  }

  const base = await getBaseCurrency(client, companyId);
  const currencyCode = base.data?.code ?? "";

  // Keyset pagination over accountNumber (stable identifier).
  const { page, nextCursor } = paginateByAccountNumber(
    (tb.data ?? []) as TrialBalanceRpcRow[],
    { cursor: query.cursor, limit: query.limit }
  );

  return Response.json({
    data: page.map((row) => toTrialBalanceRow(row, currencyCode)),
    meta: {
      companyId,
      bookId: null,
      periodId: query.periodId ?? null,
      dateRange: startDate && endDate ? { startDate, endDate } : null,
      generatedAt: new Date().toISOString(),
      nextCursor
    }
  });
}
