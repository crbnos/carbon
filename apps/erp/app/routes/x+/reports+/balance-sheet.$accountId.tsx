// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { financialReportParamsValidator } from "~/modules/accounting/accounting.models";
import { getAccountLedgerPage } from "~/modules/accounting/accounting.service";
import { AccountLedgerDrawer } from "~/modules/accounting/ui/Reports";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, api } = await authorize(request, {
    "accounting.reporting": "View"
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  // Parsed as the report does, so a malformed date falls back to its defaults.
  const parsed = financialReportParamsValidator.safeParse(
    Object.fromEntries(searchParams.entries())
  );
  const report = parsed.success ? parsed.data : null;
  const companiesParam = report?.companies ?? null;
  // The balance sheet is an as-of statement: the window is inception → endDate,
  // and endDate defaults to the company's today, as the report's does.
  const startDate = null;
  const endDate =
    report?.endDate ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  const isConsolidated = companiesParam === "all";
  const selectedCompanyId = isConsolidated
    ? null
    : (companiesParam ?? companyId);

  const [account, ledger] = await Promise.all([
    api.accounting.getAccount({ accountId }),
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
