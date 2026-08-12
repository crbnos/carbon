import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import type { PivotState } from "~/modules/accounting";
import {
  analyticsReportKeys,
  analyticsReports,
  getDimensionPivotLines,
  getScrapAccountIds,
  pivotStateValidator
} from "~/modules/accounting";

/**
 * Fetcher endpoint for the analytics pivot drill-through drawer
 * (analytics.$reportKey.tsx). Returns the journal lines behind one pivot cell.
 *
 * Query params (written by the analytics report route via
 * path.to.api.analyticsReportLines):
 * - reportKey            — one of analyticsReportKeys
 * - startDate / endDate  — YYYY-MM-DD report range (required)
 * - filters              — JSON-encoded [{ dimensionId, valueIds }] (optional)
 * - accounts             — comma-separated account ids narrowing the scope (optional)
 * - r1d / r1 / r1null=1  — row dimension 1 id + value id; r1null (with no r1)
 *                          means the Unassigned bucket — the dimension is sent
 *                          to the RPC without a value. Omitting r1d leaves the
 *                          axis unconstrained (row totals, parent cells).
 * - r2d / r2 / r2null=1  — same for row dimension 2
 * - cold / colv / colvnull=1 — column dimension id + value (dimension axis)
 * - colstart / colend    — period column bounds (period axis)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const reportKey = analyticsReportKeys.find(
    (key) => key === searchParams.get("reportKey")
  );
  if (!reportKey) {
    throw new Response("Not found", { status: 404 });
  }
  const report = analyticsReports[reportKey];

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!startDate || !endDate) {
    throw new Response("Bad request", { status: 400 });
  }

  let filters: PivotState["filters"] = [];
  const filtersParam = searchParams.get("filters");
  if (filtersParam) {
    try {
      const parsed = pivotStateValidator.shape.filters.safeParse(
        JSON.parse(filtersParam)
      );
      if (parsed.success) filters = parsed.data;
    } catch {
      // Malformed filters param — ignore it rather than 500
    }
  }

  let scrapAccountIds: string[] | undefined;
  if ("source" in report.accountScope) {
    scrapAccountIds = (await getScrapAccountIds(client, companyId)).data;
  }

  const optional = (name: string) => searchParams.get(name) ?? undefined;

  const lines = await getDimensionPivotLines(client, {
    companyId,
    companyGroupId,
    report,
    scrapAccountIds,
    startDate,
    endDate,
    filters,
    rowDimension1: optional("r1d"),
    rowValue1: optional("r1"),
    rowValue1IsNull: searchParams.get("r1null") === "1",
    rowDimension2: optional("r2d"),
    rowValue2: optional("r2"),
    rowValue2IsNull: searchParams.get("r2null") === "1",
    columnDimension: optional("cold"),
    columnValue: optional("colv"),
    columnValueIsNull: searchParams.get("colvnull") === "1",
    columnPeriodStart: optional("colstart"),
    columnPeriodEnd: optional("colend"),
    accountIds: searchParams.get("accounts")?.split(",").filter(Boolean) ?? []
  });

  // The drawer shows its empty state rather than a route error boundary
  return { lines: lines.data ?? [] };
}
