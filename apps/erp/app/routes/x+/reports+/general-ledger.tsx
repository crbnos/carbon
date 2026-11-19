// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation } from "react-router";
import {
  GENERAL_LEDGER_PAGING,
  getAccountsList,
  getGeneralLedgerDimensions,
  getGeneralLedgerLines,
  withGeneralLedgerCounterparties,
  withGeneralLedgerDimensions
} from "~/modules/accounting/accounting.service";
import {
  GeneralLedgerTable,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { toPage } from "~/utils/cursor";
import type { Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/list-error";
import { path } from "~/utils/path";
import { resolveGeneralLedgerRequest } from "./general-ledger.server";

const logger = getLogger("erp", "reports-general-ledger");

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
    cursor
  } = await resolveGeneralLedgerRequest(request);

  const [lines, accounts, dimensions] = await Promise.all([
    getGeneralLedgerLines(client, selectedCompany.id, {
      ...query,
      limit,
      cursor
    }),
    getAccountsList(client, companyGroupId, { isGroup: false }),
    getGeneralLedgerDimensions(client, companyGroupId)
  ]);

  if (dimensions.error) {
    logger.error("Failed to load the dimensions of the general ledger", {
      companyId: selectedCompany.id,
      error: dimensions.error
    });
    if (cursor) return listErrorPage("lines");
    throw redirect(
      path.to.reports,
      await flash(
        request,
        error(dimensions.error, "Failed to load general ledger")
      )
    );
  }

  if (lines.error && cursor) {
    logger.error("Failed to load a later page of the general ledger", {
      companyId: selectedCompany.id,
      error: lines.error
    });
    return listErrorPage("lines");
  }

  if (lines.error) {
    throw redirect(
      path.to.reports,
      await flash(request, error(lines.error, "Failed to load general ledger"))
    );
  }

  const page = toPage(
    lines.data ?? [],
    { limit, sorts: query.sorts },
    GENERAL_LEDGER_PAGING
  );
  const counterparties = await withGeneralLedgerCounterparties(
    client,
    selectedCompany.id,
    page.rows
  );
  const rows = counterparties.error
    ? counterparties
    : await withGeneralLedgerDimensions(
        client,
        selectedCompany.id,
        counterparties.data
      );
  if (rows.error) {
    logger.error(
      "Failed to load the documents and dimensions of the general ledger",
      {
        companyId: selectedCompany.id,
        error: rows.error
      }
    );
    if (cursor) return listErrorPage("lines");
    throw redirect(
      path.to.reports,
      await flash(request, error(rows.error, "Failed to load general ledger"))
    );
  }

  return {
    lines: rows.data,
    count: lines.count ?? 0,
    nextCursor: page.nextCursor,
    accounts: accounts.data ?? [],
    dimensions: dimensions.data ?? [],
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
    nextCursor,
    accounts,
    dimensions,
    companies,
    selectedCompanyId,
    currencyCode,
    fiscalStartMonth
  } = useLoaderData<typeof loader>();
  const { search } = useLocation();

  const onDownload = () => {
    const params = new URLSearchParams(search);
    params.delete("after");
    const query = params.toString();
    window.location.assign(
      query ? `${path.to.generalLedgerCsv}?${query}` : path.to.generalLedgerCsv
    );
  };

  return (
    <VStack spacing={0} className="h-full">
      <h1 className="sr-only">
        <Trans>General Ledger</Trans>
      </h1>
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
        nextCursor={nextCursor}
        accounts={accounts}
        dimensions={dimensions}
        currencyCode={currencyCode}
      />
    </VStack>
  );
}
