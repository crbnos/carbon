// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Combobox, cn, DatePicker, HStack, VStack } from "@carbon/react";
import { datetime, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Table } from "~/components";
import { useCurrencyFormatter, useUrlParams } from "~/hooks";
import type { TaxLiabilityRow } from "~/modules/accounting";
import { getTaxAuthoritiesList, getTaxLiability } from "~/modules/accounting";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Tax Liability`,
  to: path.to.taxLiability,
  module: "accounting"
};

// A bad bookmark must not 500 — an unparseable date falls back to the default.
function parseDateParam(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return parseDate(raw).toString();
  } catch {
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  // Default: quarter to date in the company's calendar.
  const today = datetime.today(await getCompanyTimeZone(client, companyId));
  const quarterStart = today.set({
    month: today.month - ((today.month - 1) % 3),
    day: 1
  });
  let from =
    parseDateParam(url.searchParams.get("from")) ?? quarterStart.toString();
  let to = parseDateParam(url.searchParams.get("to")) ?? today.toString();
  if (to < from) [from, to] = [to, from];
  const taxAuthorityId = url.searchParams.get("taxAuthorityId") || null;

  const [rows, authorities] = await Promise.all([
    getTaxLiability(getDatabaseClient(), companyId, {
      startDate: from,
      endDate: to,
      taxAuthorityId
    }),
    getTaxAuthoritiesList(client, companyId)
  ]);

  return {
    from,
    to,
    taxAuthorityId,
    rows,
    authorities: (authorities.data ?? []).map((a) => ({
      value: a.id,
      label: a.name
    }))
  };
}

type TaxLiabilityDisplayRow = Omit<
  TaxLiabilityRow,
  "taxAuthorityId" | "authorityName" | "componentName"
> & {
  key: string;
  authority: string;
  component: string;
  isTotal: boolean;
};

export default function TaxLiabilityRoute() {
  const { from, to, taxAuthorityId, rows, authorities } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();

  const displayRows = useMemo<TaxLiabilityDisplayRow[]>(() => {
    const out: TaxLiabilityDisplayRow[] = rows.map((row, index) => ({
      key: `${row.taxAuthorityId ?? ""}:${row.componentName ?? ""}:${index}`,
      authority: row.authorityName ?? t`No authority`,
      component: row.componentName ?? t`No tax code`,
      taxableSales: row.taxableSales,
      exemptSales: row.exemptSales,
      taxCollected: row.taxCollected,
      taxablePurchases: row.taxablePurchases,
      selfAssessedTax: row.selfAssessedTax,
      recoverableTax: row.recoverableTax,
      netDue: row.netDue,
      isTotal: false
    }));
    if (rows.length > 0) {
      const sum = (pick: (row: TaxLiabilityRow) => number) =>
        round(rows.reduce((total, row) => total + pick(row), 0));
      out.push({
        key: "total",
        authority: t`Total`,
        component: "",
        taxableSales: sum((row) => row.taxableSales),
        exemptSales: sum((row) => row.exemptSales),
        taxCollected: sum((row) => row.taxCollected),
        taxablePurchases: sum((row) => row.taxablePurchases),
        selfAssessedTax: sum((row) => row.selfAssessedTax),
        recoverableTax: sum((row) => row.recoverableTax),
        netDue: sum((row) => row.netDue),
        isTotal: true
      });
    }
    return out;
  }, [rows, t]);

  const columns = useMemo<ColumnDef<TaxLiabilityDisplayRow>[]>(() => {
    const amount =
      (key: keyof TaxLiabilityRow & keyof TaxLiabilityDisplayRow) =>
      ({ row }: { row: { original: TaxLiabilityDisplayRow } }) => (
        <span
          className={cn(
            "tabular-nums",
            row.original.isTotal && "font-semibold"
          )}
        >
          {currencyFormatter.format(row.original[key] as number)}
        </span>
      );
    const amountColumn = (
      key:
        | "taxableSales"
        | "exemptSales"
        | "taxCollected"
        | "taxablePurchases"
        | "selfAssessedTax"
        | "recoverableTax"
        | "netDue",
      header: string
    ): ColumnDef<TaxLiabilityDisplayRow> => ({
      accessorKey: key,
      header,
      cell: amount(key),
      meta: { exportValue: (row: TaxLiabilityDisplayRow) => row[key] }
    });

    return [
      {
        accessorKey: "authority",
        header: t`Authority`,
        cell: ({ row }) => (
          <span className={cn(row.original.isTotal && "font-semibold")}>
            {row.original.authority}
          </span>
        ),
        meta: { exportValue: (row: TaxLiabilityDisplayRow) => row.authority }
      },
      {
        accessorKey: "component",
        header: t`Component`,
        cell: ({ row }) => row.original.component,
        meta: { exportValue: (row: TaxLiabilityDisplayRow) => row.component }
      },
      amountColumn("taxableSales", t`Taxable Sales`),
      amountColumn("exemptSales", t`Exempt Sales`),
      amountColumn("taxCollected", t`Tax Collected`),
      amountColumn("taxablePurchases", t`Taxable Purchases`),
      amountColumn("selfAssessedTax", t`Self-Assessed Tax`),
      amountColumn("recoverableTax", t`Recoverable Tax`),
      amountColumn("netDue", t`Net Due`)
    ];
  }, [t, currencyFormatter]);

  const filters = (
    <HStack>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>From:</Trans>
      </span>
      <DatePicker
        size="sm"
        value={parseDate(from)}
        onChange={(value) => setParams({ from: value?.toString() ?? from })}
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>To:</Trans>
      </span>
      <DatePicker
        size="sm"
        value={parseDate(to)}
        onChange={(value) => setParams({ to: value?.toString() ?? to })}
      />
      <Combobox
        size="sm"
        className="w-48"
        options={authorities}
        value={taxAuthorityId ?? undefined}
        placeholder={t`All authorities`}
        isClearable
        onChange={(value) => setParams({ taxAuthorityId: value || null })}
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        {/* Every row is returned at once; search, sort and pagination are
            URL-driven controls this loader does not read. */}
        <Table<TaxLiabilityDisplayRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Tax Liability`}
          primaryAction={filters}
          withPagination={false}
          withSearch={false}
          withSimpleSorting={false}
        />
      </div>
    </VStack>
  );
}
