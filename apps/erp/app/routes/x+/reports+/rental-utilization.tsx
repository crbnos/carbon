import { requirePermissions } from "@carbon/auth/auth.server";
import { Combobox, cn, DatePicker, HStack, VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Table } from "~/components";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter,
  useUrlParams
} from "~/hooks";
import type {
  RentalUtilizationRow,
  RentalUtilizationTotals
} from "~/modules/accounting";
import {
  getFixedAssetClassesList,
  getRentalUtilization
} from "~/modules/accounting";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Rental Utilization`,
  to: path.to.rentalUtilization,
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
  // Default: quarter to date in the company's calendar. Stopping at today
  // keeps an open line's `returnedAt ?? to` from counting days not yet rented.
  const today = datetime.today(await getCompanyTimeZone(client, companyId));
  const quarterStart = today.set({
    month: today.month - ((today.month - 1) % 3),
    day: 1
  });
  let from =
    parseDateParam(url.searchParams.get("from")) ?? quarterStart.toString();
  let to = parseDateParam(url.searchParams.get("to")) ?? today.toString();
  if (to < from) [from, to] = [to, from];
  const fixedAssetClassId = url.searchParams.get("fixedAssetClassId") || null;

  const [utilization, classes] = await Promise.all([
    getRentalUtilization(client, companyId, { from, to, fixedAssetClassId }),
    getFixedAssetClassesList(client, companyId)
  ]);
  // A failed query must surface, not render as an idle fleet.
  if (utilization.error) {
    throw new Error(utilization.error.message);
  }

  return {
    from,
    to,
    fixedAssetClassId,
    assets: utilization.data?.assets ?? [],
    classTotals: utilization.data?.classTotals ?? [],
    classes: (classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))
  };
}

type UtilizationDisplayRow = Omit<
  RentalUtilizationTotals,
  "acquisitionCost"
> & {
  key: string;
  /** `fixedAsset.id`; null on a total row. */
  assetId: string | null;
  asset: string;
  isTotal: boolean;
};

export default function RentalUtilizationRoute() {
  const { from, to, fixedAssetClassId, assets, classTotals, classes } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const quantityFormatter = useQuantityFormatter();

  // Each class's assets followed by the class-total row. The service returns
  // assets sorted by class name, and totals already computed and rounded.
  const displayRows = useMemo<UtilizationDisplayRow[]>(() => {
    const assetRow = (row: RentalUtilizationRow): UtilizationDisplayRow => ({
      key: row.id,
      assetId: row.id,
      asset: `${row.fixedAssetId} ${row.name}`,
      fixedAssetClassId: row.fixedAssetClassId,
      className: row.className,
      fleetDays: row.fleetDays,
      onRentDays: row.onRentDays,
      timeUtilization: row.timeUtilization,
      recognizedIncome: row.recognizedIncome,
      dollarUtilization: row.dollarUtilization,
      isTotal: false
    });
    const out: UtilizationDisplayRow[] = [];
    for (const total of classTotals) {
      for (const row of assets) {
        if (row.fixedAssetClassId === total.fixedAssetClassId) {
          out.push(assetRow(row));
        }
      }
      out.push({
        key: `total:${total.fixedAssetClassId}`,
        assetId: null,
        asset: t`Total ${total.className}`,
        fixedAssetClassId: total.fixedAssetClassId,
        className: total.className,
        fleetDays: total.fleetDays,
        onRentDays: total.onRentDays,
        timeUtilization: total.timeUtilization,
        recognizedIncome: total.recognizedIncome,
        dollarUtilization: total.dollarUtilization,
        isTotal: true
      });
    }
    return out;
  }, [assets, classTotals, t]);

  const columns = useMemo<ColumnDef<UtilizationDisplayRow>[]>(() => {
    const percent = (value: number | null) =>
      value === null ? "" : percentFormatter.format(value);
    const numberCell =
      (render: (row: UtilizationDisplayRow) => string) =>
      ({ row }: { row: { original: UtilizationDisplayRow } }) => (
        <span
          className={cn(
            "tabular-nums",
            row.original.isTotal && "font-semibold"
          )}
        >
          {render(row.original)}
        </span>
      );

    return [
      {
        accessorKey: "asset",
        header: t`Asset`,
        cell: ({ row }) =>
          row.original.assetId ? (
            <Link
              to={path.to.fixedAsset(row.original.assetId)}
              className="hover:underline"
            >
              {row.original.asset}
            </Link>
          ) : (
            <span className="font-semibold">{row.original.asset}</span>
          ),
        meta: { exportValue: (row: UtilizationDisplayRow) => row.asset }
      },
      {
        accessorKey: "className",
        header: t`Class`,
        cell: ({ row }) => row.original.className,
        meta: { exportValue: (row: UtilizationDisplayRow) => row.className }
      },
      {
        accessorKey: "fleetDays",
        header: t`Fleet Days`,
        cell: numberCell((row) => quantityFormatter(row.fleetDays)),
        meta: { exportValue: (row: UtilizationDisplayRow) => row.fleetDays }
      },
      {
        accessorKey: "onRentDays",
        header: t`On-Rent Days`,
        cell: numberCell((row) => quantityFormatter(row.onRentDays)),
        meta: { exportValue: (row: UtilizationDisplayRow) => row.onRentDays }
      },
      {
        accessorKey: "timeUtilization",
        header: t`Time Utilization`,
        cell: numberCell((row) => percent(row.timeUtilization)),
        meta: {
          exportValue: (row: UtilizationDisplayRow) => row.timeUtilization ?? ""
        }
      },
      {
        accessorKey: "recognizedIncome",
        header: t`Recognized Income`,
        cell: numberCell((row) =>
          currencyFormatter.format(row.recognizedIncome)
        ),
        meta: {
          exportValue: (row: UtilizationDisplayRow) => row.recognizedIncome
        }
      },
      {
        accessorKey: "dollarUtilization",
        header: t`Dollar Utilization`,
        cell: numberCell((row) => percent(row.dollarUtilization)),
        meta: {
          exportValue: (row: UtilizationDisplayRow) =>
            row.dollarUtilization ?? ""
        }
      }
    ];
  }, [t, currencyFormatter, percentFormatter, quantityFormatter]);

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
        options={classes}
        value={fixedAssetClassId ?? undefined}
        placeholder={t`All classes`}
        isClearable
        onChange={(value) => setParams({ fixedAssetClassId: value || null })}
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        {/* Every row is returned at once, and search / sort / pagination are
            URL-driven server-side controls this loader does not read — turn
            them off rather than render controls that do nothing. */}
        <Table<UtilizationDisplayRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Rental Utilization`}
          primaryAction={filters}
          withPagination={false}
          withSearch={false}
          withSimpleSorting={false}
        />
      </div>
    </VStack>
  );
}
