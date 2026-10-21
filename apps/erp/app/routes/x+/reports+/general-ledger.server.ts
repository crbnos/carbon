// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The general ledger page and its CSV download read the same lines, so they
// share the request's parsing: the company, the period and the table's search,
// filters and sorts.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { datetime, defaultReportRange, redirect } from "@carbon/utils";
import { financialReportParamsValidator } from "~/modules/accounting/accounting.models";
import {
  getCompaniesInGroup,
  getFiscalYearSettings
} from "~/modules/accounting/accounting.service";
import { months } from "~/modules/shared/shared.models";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "reports-general-ledger");

export async function resolveGeneralLedgerRequest(request: Request) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // Invalid params fall back to defaults — a bad bookmark must not 500
  const parsed = financialReportParamsValidator.safeParse(
    Object.fromEntries(searchParams.entries())
  );
  const companiesParam = parsed.success
    ? (parsed.data.companies ?? null)
    : null;
  const startDateParam = parsed.success
    ? (parsed.data.startDate ?? null)
    : null;
  const endDateParam = parsed.success ? (parsed.data.endDate ?? null) : null;

  const [companies, fiscalYearSettings] = await Promise.all([
    getCompaniesInGroup(client, companyGroupId),
    getFiscalYearSettings(client, companyId)
  ]);
  if (companies.error) {
    throw redirect(
      path.to.reports,
      await flash(
        request,
        error(companies.error, "Failed to load report companies")
      )
    );
  }
  const companiesList = companies.data ?? [];

  // One company at a time: each company's lines are in its own base currency,
  // so a list across companies would add unlike amounts.
  const selectedCompanyId =
    companiesParam && companiesParam !== "all" ? companiesParam : companyId;
  const selectedCompany = companiesList.find(
    (company) => company.id === selectedCompanyId
  );
  if (!selectedCompany) {
    logger.error("General ledger company is not in the caller's group", {
      companyGroupId,
      selectedCompanyId
    });
    throw new Response("The company could not be found.", { status: 404 });
  }

  // The same default window as the trial balance, so a drill from one to the
  // other reads the same lines
  const range = defaultReportRange(
    endDateParam ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return {
    client,
    companies: companiesList,
    selectedCompany,
    fiscalStartMonth:
      months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1,
    companyGroupId,
    query: {
      search: searchParams.get("search"),
      startDate: startDateParam ?? range.startDate,
      endDate: endDateParam ?? range.endDate,
      sorts,
      filters
    },
    limit,
    offset
  };
}
