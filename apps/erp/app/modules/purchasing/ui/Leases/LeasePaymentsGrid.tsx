// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuPlus, LuRefreshCw, LuTrash } from "react-icons/lu";
import { DateTime, Table } from "~/components";
import { EditableDate, EditableNumber } from "~/components/Editable";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import Money from "~/components/Money";
import {
  rowMenuColumn,
  SetupSection,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import LeasePaymentForm from "./LeasePaymentForm";
import type { Lease, LeaseLine, LeasePayment } from "./types";
import { useLeasePaymentTypeLabel } from "./useLeaseLabels";

type PaymentRow = {
  id: string;
  number: number;
  asset: string;
  paymentType: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amount: number;
  status: string;
};

type LeasePaymentsGridProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
};

/** Every asset's payment rows as a spreadsheet: each row's period, due date
 *  and amount edit in place, one cell at a time, through the row's update
 *  route. A rent holiday or an irregular step is an edit here; Regenerate
 *  from Terms replaces every row. */
const LeasePaymentsGrid = ({
  lease,
  lines,
  payments
}: LeasePaymentsGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();
  const paymentTypeLabel = useLeasePaymentTypeLabel();

  const leaseId = lease.id!;
  const currencyCode = lease.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const canEdit =
    lease.status === "Draft" && permissions.can("update", "purchasing");

  const addPayment = useDisclosure();
  const regenerate = useDisclosure();
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);

  const assetName = useMemo(
    () => new Map(lines.map((line) => [line.id, line.description])),
    [lines]
  );
  const hasSeveralAssets = lines.length > 1;

  const rows = useMemo<PaymentRow[]>(
    () =>
      payments.map((payment, index) => ({
        id: payment.id,
        number: index + 1,
        asset: assetName.get(payment.leaseLineId) ?? "",
        paymentType: payment.paymentType,
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        dueDate: payment.dueDate,
        amount: Number(payment.amount),
        status: payment.status
      })),
    [payments, assetName]
  );
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: PaymentRow) =>
      save(path.to.leasePaymentUpdate(leaseId, row.id), {
        field: accessorKey,
        value: value === null || value === undefined ? "" : String(value)
      }),
    [leaseId, save]
  );

  const columns = useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        accessorKey: "number",
        header: "#",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.number}
          </span>
        )
      },
      ...(hasSeveralAssets
        ? [
            {
              accessorKey: "asset",
              header: t`Asset`,
              cell: ({ row }: { row: { original: PaymentRow } }) => (
                <span className="block max-w-[200px] truncate">
                  {row.original.asset}
                </span>
              )
            } satisfies ColumnDef<PaymentRow>
          ]
        : []),
      {
        accessorKey: "paymentType",
        header: t`Type`,
        cell: ({ row }) => paymentTypeLabel(row.original.paymentType)
      },
      {
        accessorKey: "periodStart",
        header: t`Period Start`,
        cell: ({ row }) => (
          <DateTime value={row.original.periodStart} variant="date" />
        )
      },
      {
        accessorKey: "periodEnd",
        header: t`Period End`,
        cell: ({ row }) => (
          <DateTime value={row.original.periodEnd} variant="date" />
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due`,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <DateTime value={row.original.dueDate} variant="date" />
            {row.original.status === "Skipped" && (
              <span className="text-xs text-muted-foreground">
                <Trans>Paid outside Carbon</Trans>
              </span>
            )}
          </span>
        )
      },
      {
        accessorKey: "amount",
        header: t`Amount`,
        cell: ({ row }) => (
          <Money value={row.original.amount} currencyCode={currencyCode} />
        )
      }
    ],
    [t, currencyCode, paymentTypeLabel, hasSeveralAssets]
  );

  const editableComponents = useMemo(
    () => ({
      periodStart: EditableDate<PaymentRow>(onCellEdit, {
        label: t`Period Start`
      }),
      periodEnd: EditableDate<PaymentRow>(onCellEdit, {
        label: t`Period End`
      }),
      dueDate: EditableDate<PaymentRow>(onCellEdit, { label: t`Due` }),
      amount: EditableNumber<PaymentRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.money(currencyDecimals),
        formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
      })
    }),
    [onCellEdit, currencyCode, currencyDecimals, t]
  );

  const renderRowMenu = useCallback(
    (row: PaymentRow) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={!canEdit}
        onClick={() => setDeleting(row)}
      >
        <MenuIcon icon={<LuTrash />} />
        <Trans>Delete Payment</Trans>
      </MenuItem>
    ),
    [canEdit]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderRowMenu, t`Actions`)],
    [columns, renderRowMenu, t]
  );

  return (
    <SetupSection
      title={<Trans>Payment Rows</Trans>}
      description={
        <Trans>
          What the lease pays and when. Activation values the lease liability
          from these rows. Click a cell to change it.
        </Trans>
      }
      actions={
        <Button
          variant="secondary"
          leftIcon={<LuRefreshCw />}
          isDisabled={!canEdit}
          onClick={regenerate.onOpen}
        >
          <Trans>Regenerate from Terms</Trans>
        </Button>
      }
    >
      <div className="flex w-full flex-col gap-4">
        {rows.length === 0 ? (
          <div className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              <Trans>
                No payment rows yet. Give each asset its payment on the Assets
                step, or add a row.
              </Trans>
            </p>
            <Button
              leftIcon={<LuPlus />}
              isDisabled={!canEdit || lines.length === 0}
              onClick={addPayment.onOpen}
            >
              <Trans>Add Payment</Trans>
            </Button>
          </div>
        ) : (
          <>
            <div
              className="w-full overflow-hidden rounded-lg border border-border"
              style={{ height: setupGridHeight(rows.length, 49) }}
            >
              <Table<PaymentRow>
                compact
                columns={gridColumns}
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
            <div className="flex w-full items-center justify-between gap-4">
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                isDisabled={!canEdit || lines.length === 0}
                onClick={addPayment.onOpen}
              >
                <Trans>Add Payment</Trans>
              </Button>
              <span className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground">
                  <Trans>Total Payments</Trans>
                </span>
                <Money value={total} currencyCode={currencyCode} />
              </span>
            </div>
          </>
        )}
      </div>

      {addPayment.isOpen && lines[0] && (
        <LeasePaymentForm
          initialValues={{
            leaseId,
            leaseLineId: lines[0].id,
            paymentType: "Rent",
            periodStart: lease.commencementDate ?? "",
            periodEnd: lease.commencementDate ?? "",
            dueDate: lease.commencementDate ?? "",
            amount: Number(lines[0].paymentAmount ?? 0)
          }}
          assets={lines}
          currencyCode={currencyCode}
          onClose={addPayment.onClose}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.leasePaymentDelete(leaseId, deleting.id)}
          name={t`payment ${deleting.number}`}
          text={t`Are you sure you want to delete payment ${deleting.number}?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}

      {regenerate.isOpen && (
        <Confirm
          action={path.to.leasePaymentsRegenerate(leaseId)}
          title={t`Regenerate payments from the terms?`}
          text={t`Every asset's payment rows are cut again from the payment terms. Rows you edited, added or deleted are replaced.`}
          confirmText={t`Regenerate`}
          confirmVariant="destructive"
          onCancel={regenerate.onClose}
          onSubmit={regenerate.onClose}
        />
      )}
    </SetupSection>
  );
};

export default LeasePaymentsGrid;
