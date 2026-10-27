// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { DateTime, EmployeeAvatar, Table } from "~/components";
import { EditableNumber } from "~/components/Editable";
import Money from "~/components/Money";
import { setupGridHeight, useCellSave } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type CurrencyRevaluationRun =
  Database["public"]["Tables"]["currencyRevaluationRun"]["Row"];
type CurrencyRevaluationLine =
  Database["public"]["Tables"]["currencyRevaluationLine"]["Row"];

type BalanceRow = {
  id: string;
  account: string;
  currencyCode: string;
  openAmount: number | null;
  openAmountEnteredBy: string | null;
  openAmountEnteredAt: string | null;
};

type CurrencyRevaluationBalancesGridProps = {
  run: CurrencyRevaluationRun;
  lines: CurrencyRevaluationLine[];
};

/** The run's foreign-currency balance accounts as a spreadsheet: on a Draft
 *  run the accountant enters each account's period-end statement balance in
 *  its own currency, and the line revalues. */
const CurrencyRevaluationBalancesGrid = ({
  run,
  lines
}: CurrencyRevaluationBalancesGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();

  const runId = run.id;
  const canEdit =
    run.status === "Draft" && permissions.can("update", "accounting");

  const rows = useMemo<BalanceRow[]>(
    () =>
      lines
        .filter((line) => line.exposureType === "Account Balance")
        .map((line) => ({
          id: line.id,
          account: line.documentNumber ?? "",
          currencyCode: line.currencyCode,
          openAmount: line.openAmount === null ? null : Number(line.openAmount),
          openAmountEnteredBy: line.openAmountEnteredBy,
          openAmountEnteredAt: line.openAmountEnteredAt
        })),
    [lines]
  );

  const onCellEdit = useCallback(
    (_accessorKey: string, value: unknown, row: BalanceRow) =>
      save(path.to.currencyRevaluationRunBalance(runId), {
        lineId: row.id,
        openAmount:
          value === null ||
          value === undefined ||
          (typeof value === "number" && Number.isNaN(value))
            ? ""
            : String(value)
      }),
    [runId, save]
  );

  const columns = useMemo<ColumnDef<BalanceRow>[]>(
    () => [
      {
        accessorKey: "account",
        header: t`Account`,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.account}</span>
        )
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => row.original.currencyCode
      },
      {
        accessorKey: "openAmount",
        header: t`Statement Balance`,
        cell: ({ row }) =>
          row.original.openAmount === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Money
              value={row.original.openAmount}
              currencyCode={row.original.currencyCode}
            />
          )
      },
      {
        accessorKey: "openAmountEnteredBy",
        header: t`Entered By`,
        cell: ({ row }) =>
          row.original.openAmountEnteredBy ? (
            <EmployeeAvatar employeeId={row.original.openAmountEnteredBy} />
          ) : null
      },
      {
        accessorKey: "openAmountEnteredAt",
        header: t`Entered`,
        cell: ({ row }) =>
          row.original.openAmountEnteredAt ? (
            <DateTime value={row.original.openAmountEnteredAt} />
          ) : null
      }
    ],
    [t]
  );

  const editableComponents = useMemo(
    () => ({
      openAmount: EditableNumber<BalanceRow>(onCellEdit, {
        step: INPUT_STEP.quantity,
        formatOptions: INPUT_FORMAT.quantity
      })
    }),
    [onCellEdit]
  );

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(rows.length) }}
    >
      <Table<BalanceRow>
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

export default CurrencyRevaluationBalancesGrid;
