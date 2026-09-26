import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getAccount,
  getAccountLedger,
  getAccountLedgerSummary
} from "~/modules/accounting";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting-charts-ledger");

const LEDGER_PAGE_SIZE = 50;

export async function loader({ request, params }: LoaderFunctionArgs) {
  // bypassRls matches the chart of accounts page, whose balances span every
  // company in the group regardless of the user's per-company roles
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
    bypassRls: true
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // bypassRls makes `client` the service role and the ledger read below is
  // unscoped by company, so the account must be proven to be this group's
  // before any of its lines are read.
  const account = await getAccount(client, accountId);
  if (account.error || !account.data) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }
  if (account.data.companyGroupId !== companyGroupId) {
    logger.error("Account is not in the caller's company group", {
      companyGroupId,
      accountId
    });
    throw redirect(path.to.chartOfAccounts);
  }

  const [ledger, summary] = await Promise.all([
    getAccountLedger(client, {
      accountId,
      companyId: null,
      startDate,
      endDate,
      limit: LEDGER_PAGE_SIZE,
      offset
    }),
    getAccountLedgerSummary(client, companyGroupId, null, {
      accountId,
      startDate,
      endDate
    })
  ]);

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

export default function ChartOfAccountsLedgerRoute() {
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
      backTo={path.to.chartOfAccounts}
    />
  );
}
