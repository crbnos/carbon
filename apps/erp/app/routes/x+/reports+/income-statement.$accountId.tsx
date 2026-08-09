import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getAccount,
  getAccountLedger,
  getAccountLedgerSummary
} from "~/modules/accounting";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { path } from "~/utils/path";

const LEDGER_PAGE_SIZE = 50;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const companiesParam = searchParams.get("companies");
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const selectedCompanyId =
    companiesParam === "all" ? null : (companiesParam ?? companyId);

  const [account, ledger, summary] = await Promise.all([
    getAccount(client, accountId),
    getAccountLedger(client, {
      accountId,
      companyId: selectedCompanyId,
      startDate,
      endDate,
      limit: LEDGER_PAGE_SIZE,
      offset
    }),
    getAccountLedgerSummary(client, companyGroupId, selectedCompanyId, {
      accountId,
      startDate,
      endDate
    })
  ]);

  if (account.error || !account.data) {
    throw redirect(
      path.to.incomeStatement,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return {
    account: account.data,
    lines: ledger.data ?? [],
    count: ledger.count ?? 0,
    summary: summary.data ?? { opening: 0, netChange: 0, closing: 0 },
    startDate,
    endDate,
    offset
  };
}

export default function IncomeStatementLedgerRoute() {
  const { account, lines, count, summary, startDate, endDate, offset } =
    useLoaderData<typeof loader>();

  return (
    <AccountLedgerDrawer
      account={account}
      lines={lines}
      count={count}
      summary={summary}
      startDate={startDate}
      endDate={endDate}
      offset={offset}
      limit={LEDGER_PAGE_SIZE}
      backTo={path.to.incomeStatement}
    />
  );
}
