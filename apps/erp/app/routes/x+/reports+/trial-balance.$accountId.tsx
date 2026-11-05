// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, defaultReportRange, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getAccount,
  getAccountLedgerPage,
  getTrialBalanceLedgerSummary
} from "~/modules/accounting/accounting.service";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
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
  const endDateParam = searchParams.get("endDate") || null;
  // The report's own default range, so a row opened with no dates in the URL
  // shows the same window.
  const range = defaultReportRange(
    endDateParam ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const startDate = searchParams.get("startDate") || range.startDate;
  const endDate = endDateParam ?? range.endDate;
  const after = searchParams.get("after");
  const isConsolidated = companiesParam === "all";
  const selectedCompanyId = isConsolidated
    ? null
    : (companiesParam ?? companyId);

  const [account, ledger, rowSummary] = await Promise.all([
    getAccount(client, accountId),
    // A later page (`?after=`) is read for its lines only.
    getAccountLedgerPage(client, {
      accountId,
      companyGroupId,
      companyId: selectedCompanyId,
      consolidated: isConsolidated,
      startDate,
      endDate,
      after
    }),
    // One company's row is closed into Retained Earnings and debit-signed, and
    // the summary must read as that row does.
    selectedCompanyId && !after
      ? getTrialBalanceLedgerSummary(
          client,
          companyGroupId,
          selectedCompanyId,
          {
            accountId,
            startDate,
            endDate
          }
        )
      : null
  ]);

  if (account.error || !account.data) {
    throw redirect(
      path.to.trialBalance,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  if (rowSummary?.error) {
    throw redirect(
      path.to.trialBalance,
      await flash(request, error(rowSummary.error, "Failed to load account"))
    );
  }

  return {
    account: account.data,
    ...ledger,
    summary: rowSummary?.data ?? ledger.summary,
    startDate,
    endDate
  };
}

export default function TrialBalanceLedgerRoute() {
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
      backTo={path.to.trialBalance}
    />
  );
}
