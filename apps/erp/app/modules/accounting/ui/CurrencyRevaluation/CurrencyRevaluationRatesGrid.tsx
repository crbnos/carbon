// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { formatExchangeRate, INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { Table } from "~/components";
import { EditableNumber } from "~/components/Editable";
import { setupGridHeight, useCellSave } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type CurrencyRevaluationRun =
  Database["public"]["Tables"]["currencyRevaluationRun"]["Row"];
type CurrencyRevaluationRate =
  Database["public"]["Tables"]["currencyRevaluationRate"]["Row"];

type RateRow = {
  id: string;
  currencyCode: string;
  rate: number;
  rateSource: string;
};

type CurrencyRevaluationRatesGridProps = {
  run: CurrencyRevaluationRun;
  rates: CurrencyRevaluationRate[];
};

/** The run's rate per currency as a spreadsheet: on a Draft run each rate
 *  edits in place and revalues that currency's lines. */
const CurrencyRevaluationRatesGrid = ({
  run,
  rates
}: CurrencyRevaluationRatesGridProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const save = useCellSave();

  const runId = run.id;
  const canEdit =
    run.status === "Draft" && permissions.can("update", "accounting");

  const sourceLabels: Record<string, string> = useMemo(
    () => ({
      Market: t`Market`,
      Override: t`Override`,
      Manual: t`Manual`
    }),
    [t]
  );

  const rows = useMemo<RateRow[]>(
    () =>
      rates.map((rate) => ({
        id: rate.id,
        currencyCode: rate.currencyCode,
        rate: Number(rate.rate),
        rateSource: rate.rateSource
      })),
    [rates]
  );

  const onCellEdit = useCallback(
    (_accessorKey: string, value: unknown, row: RateRow) =>
      save(path.to.currencyRevaluationRunRate(runId), {
        currencyCode: row.currencyCode,
        rate:
          value === null ||
          value === undefined ||
          (typeof value === "number" && Number.isNaN(value))
            ? ""
            : String(value)
      }),
    [runId, save]
  );

  const columns = useMemo<ColumnDef<RateRow>[]>(
    () => [
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.currencyCode}</span>
        )
      },
      {
        accessorKey: "rate",
        header: t`Rate`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatExchangeRate(row.original.rate, locale)}
          </span>
        )
      },
      {
        accessorKey: "rateSource",
        header: t`Source`,
        cell: ({ row }) =>
          sourceLabels[row.original.rateSource] ?? row.original.rateSource
      }
    ],
    [t, locale, sourceLabels]
  );

  const editableComponents = useMemo(
    () => ({
      rate: EditableNumber<RateRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.exchangeRate,
        formatOptions: INPUT_FORMAT.exchangeRate
      })
    }),
    [onCellEdit]
  );

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(rows.length) }}
    >
      <Table<RateRow>
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        withInlineEditing={canEdit}
        forceEditMode={canEdit}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
      />
    </div>
  );
};

export default CurrencyRevaluationRatesGrid;
