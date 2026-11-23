// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getAccount,
  getAccountLedgerPage
} from "~/modules/accounting/accounting.service";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting-charts-ledger");

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

  // A later page (`?after=`) is read for its lines only.
  const ledger = await getAccountLedgerPage(client, {
    accountId,
    companyGroupId,
    companyId: null,
    startDate,
    endDate,
    after: searchParams.get("after")
  });

  return {
    account: account.data,
    ...ledger,
    startDate,
    endDate
  };
}

export default function ChartOfAccountsLedgerRoute() {
  const { account, lines, count, nextCursor, summary, startDate, endDate } =
    useLoaderData<typeof loader>();

  return (
    <AccountLedgerDrawer
      account={account}
      lines={lines}
      count={count}
      summary={summary}
      startDate={startDate}
      endDate={endDate}
      nextCursor={nextCursor}
      backTo={path.to.chartOfAccounts}
    />
  );
}
