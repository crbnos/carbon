import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getPurchaseLinePivotLines } from "~/modules/accounting";

/**
 * Fetcher endpoint for the Purchases pivot drill-through drawer
 * (purchases.tsx). Returns the purchase invoice lines behind one pivot cell.
 *
 * Query params (written by the purchases report route via
 * path.to.api.purchasesReportLines):
 * - startDate / endDate  — YYYY-MM-DD report range (required)
 * - r1f / r1 / r1null=1  — row field 1 key + value; r1null (no r1) is the
 *                          Unassigned bucket (field IS NULL). Omitting r1f
 *                          leaves the axis unconstrained (row totals / parents).
 * - r2f / r2 / r2null=1  — same for row field 2
 * - colf / colv / colvnull=1 — column field key + value (field axis)
 * - colstart / colend    — period column bounds (period axis)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const searchParams = new URL(request.url).searchParams;

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!startDate || !endDate) {
    throw new Response("Bad request", { status: 400 });
  }

  const optional = (name: string) => searchParams.get(name) ?? undefined;

  // A field is sent only when that axis is constrained (a value, or the
  // Unassigned bucket). r1null without r1 → send the field, omit the value.
  const rowField1 =
    searchParams.get("r1null") === "1" || optional("r1")
      ? optional("r1f")
      : undefined;
  const rowField2 =
    searchParams.get("r2null") === "1" || optional("r2")
      ? optional("r2f")
      : undefined;
  const columnField =
    searchParams.get("colvnull") === "1" || optional("colv")
      ? optional("colf")
      : undefined;

  const lines = await getPurchaseLinePivotLines(client, {
    companyId,
    startDate,
    endDate,
    rowField1,
    rowValue1: optional("r1"),
    rowField2,
    rowValue2: optional("r2"),
    columnField,
    columnValue: optional("colv"),
    columnPeriodStart: optional("colstart"),
    columnPeriodEnd: optional("colend")
  });

  return { lines: lines.data ?? [] };
}
