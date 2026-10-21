// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation } from "react-router";
import {
  getAccountsList,
  getGeneralLedgerLines
} from "~/modules/accounting/accounting.service";
import {
  GeneralLedgerTable,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { resolveGeneralLedgerRequest } from "./general-ledger.server";

export const handle: Handle = {
  breadcrumb: msg`General Ledger`,
  to: path.to.generalLedger
};

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    client,
    companies,
    selectedCompany,
    fiscalStartMonth,
    companyGroupId,
    query,
    limit,
    offset
  } = await resolveGeneralLedgerRequest(request);

  const [lines, accounts] = await Promise.all([
    getGeneralLedgerLines(client, selectedCompany.id, {
      ...query,
      limit,
      offset
    }),
    getAccountsList(client, companyGroupId, { isGroup: false })
  ]);

  if (lines.error) {
    throw redirect(
      path.to.reports,
      await flash(request, error(lines.error, "Failed to load general ledger"))
    );
  }

  return {
    lines: lines.data ?? [],
    count: lines.count ?? 0,
    accounts: accounts.data ?? [],
    companies,
    selectedCompanyId: selectedCompany.id,
    currencyCode: selectedCompany.baseCurrencyCode,
    fiscalStartMonth
  };
}

export default function GeneralLedgerRoute() {
  const {
    lines,
    count,
    accounts,
    companies,
    selectedCompanyId,
    currencyCode,
    fiscalStartMonth
  } = useLoaderData<typeof loader>();
  const { search } = useLocation();

  const onDownload = () => {
    const params = new URLSearchParams(search);
    params.delete("limit");
    params.delete("offset");
    const query = params.toString();
    window.location.assign(
      query ? `${path.to.generalLedgerCsv}?${query}` : path.to.generalLedgerCsv
    );
  };

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={[selectedCompanyId]}
        isMultiCompany={false}
        allowAllCompanies={false}
        fiscalStartMonth={fiscalStartMonth}
        showSearch={false}
        onDownload={onDownload}
      />
      <GeneralLedgerTable
        data={lines}
        count={count}
        accounts={accounts}
        currencyCode={currencyCode}
      />
    </VStack>
  );
}
