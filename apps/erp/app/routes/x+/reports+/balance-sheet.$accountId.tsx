// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getAccount,
  getAccountLedgerPage
} from "~/modules/accounting/accounting.service";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { path } from "~/utils/path";

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
  // The balance sheet is an as-of statement: the window is inception → endDate
  const startDate = null;
  const endDate = searchParams.get("endDate") || null;
  const isConsolidated = companiesParam === "all";
  const selectedCompanyId = isConsolidated
    ? null
    : (companiesParam ?? companyId);

  const [account, ledger] = await Promise.all([
    getAccount(client, accountId),
    // A later page (`?after=`) is read for its lines only.
    getAccountLedgerPage(client, {
      accountId,
      companyGroupId,
      companyId: selectedCompanyId,
      consolidated: isConsolidated,
      startDate,
      endDate,
      after: searchParams.get("after")
    })
  ]);

  if (account.error || !account.data) {
    throw redirect(
      path.to.balanceSheet,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return {
    account: account.data,
    ...ledger,
    startDate,
    endDate
  };
}

export default function BalanceSheetLedgerRoute() {
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
      backTo={path.to.balanceSheet}
    />
  );
}
