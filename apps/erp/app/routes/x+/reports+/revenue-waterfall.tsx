import { requirePermissions } from "@carbon/auth/auth.server";
import { cn, DatePicker, HStack, VStack } from "@carbon/react";
import { datetime, formatDate, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useUrlParams } from "~/hooks";
import type { DeferredRevenueWaterfallRow } from "~/modules/accounting";
import { getDeferredRevenueWaterfall } from "~/modules/accounting";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Deferred Revenue Waterfall`,
  to: path.to.revenueWaterfall,
  module: "accounting"
};

// A bad bookmark must not 500 — an unparseable `asOf` falls back to today.
function parseAsOf(raw: string | null): string | null {
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
  const asOf =
    parseAsOf(url.searchParams.get("asOf")) ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();

  const waterfall = await getDeferredRevenueWaterfall(client, companyId, {
    asOf
  });
  // A failed query must surface, not render as "nothing left to recognize".
  if (waterfall.error) {
    throw new Error(waterfall.error.message);
  }

  return { asOf, rows: waterfall.data ?? [] };
}

type ScheduleType = DeferredRevenueWaterfallRow["type"];

type WaterfallRow = {
  id: string;
  bucket: string;
  type: ScheduleType | null;
  amount: number;
  isTotal: boolean;
};

export default function RevenueWaterfallRoute() {
  const { asOf, rows } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();

  const typeLabels = useMemo<Record<ScheduleType, string>>(
    () => ({
      Deferral: t`Deferral`,
      Accrual: t`Accrual`,
      Interest: t`Interest`
    }),
    [t]
  );

  // The service rows plus a grand-total row. Accumulate at full precision and
  // round once, at this display boundary.
  const displayRows = useMemo<WaterfallRow[]>(() => {
    const out: WaterfallRow[] = rows.map((row) => ({
      id: `${row.bucket}:${row.type}`,
      bucket: row.bucket,
      type: row.type,
      amount: row.amount,
      isTotal: false
    }));
    if (rows.length > 0) {
      out.push({
        id: "total",
        bucket: "",
        type: null,
        amount: round(rows.reduce((sum, row) => sum + row.amount, 0)),
        isTotal: true
      });
    }
    return out;
  }, [rows]);

  const columns = useMemo<ColumnDef<WaterfallRow>[]>(() => {
    // `bucket` is YYYY-MM; label it by its first day so the month formatter
    // has a real date to format.
    const monthLabel = (row: WaterfallRow) =>
      row.isTotal
        ? t`Total`
        : formatDate(
            `${row.bucket}-01`,
            { month: "short", year: "numeric" },
            locale
          );
    const typeLabel = (row: WaterfallRow) =>
      row.type ? typeLabels[row.type] : "";

    return [
      {
        accessorKey: "bucket",
        header: t`Month`,
        cell: ({ row }) => (
          <span className={cn(row.original.isTotal && "font-semibold")}>
            {monthLabel(row.original)}
          </span>
        ),
        meta: { exportValue: monthLabel }
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={typeLabel(row.original)} />,
        meta: { exportValue: typeLabel }
      },
      {
        accessorKey: "amount",
        header: t`Amount`,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              row.original.isTotal && "font-semibold"
            )}
          >
            {currencyFormatter.format(row.original.amount)}
          </span>
        ),
        meta: { exportValue: (row: WaterfallRow) => row.amount }
      }
    ];
  }, [t, locale, typeLabels, currencyFormatter]);

  const filters = (
    <HStack>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>As of:</Trans>
      </span>
      <DatePicker
        size="sm"
        value={parseDate(asOf)}
        onChange={(value) => setParams({ asOf: value?.toString() ?? asOf })}
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        {/* Every row is returned at once, and search / sort / pagination are
            URL-driven server-side controls this loader does not read — turn
            them off rather than render controls that do nothing. */}
        <Table<WaterfallRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Deferred Revenue Waterfall`}
          primaryAction={filters}
          withPagination={false}
          withSearch={false}
          withSimpleSorting={false}
        />
      </div>
    </VStack>
  );
}
