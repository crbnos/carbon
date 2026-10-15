// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { Table } from "~/components";
import { EditableList, EditableNumber } from "~/components/Editable";
import { NumberControlled } from "~/components/Form";
import Money from "~/components/Money";
import {
  SetupSection,
  setupGridHeight,
  TermForm,
  useCellSave
} from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { LeaseClassificationPreview } from "./LeaseClassificationPreview";
import { useLeaseTermSave } from "./LeaseSetupSteps";
import type { Lease, LeaseLine, LeasePayment, LeasePolicy } from "./types";

type Switch = "on" | "off";

const asSwitch = (value: boolean): Switch => (value ? "on" : "off");

type AssetInputRow = {
  id: string;
  description: string;
  fairValue: number | null;
  economicLifeMonths: number | null;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: Switch;
  ownershipTransfers: Switch;
  specializedAsset: Switch;
};

type LeaseAccountingProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  leasePolicy: LeasePolicy;
};

/** Whether each asset is an operating or a finance lease (ASC 842): the live
 *  result, then the rate the payments are discounted at and each asset's
 *  inputs to the five tests. Every field saves on its own; activation
 *  classifies for good. */
const LeaseAccounting = ({
  lease,
  lines,
  payments,
  leasePolicy
}: LeaseAccountingProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const id = lease.id!;
  const { save } = useLeaseTermSave(id);
  const isDisabled =
    lease.status !== "Draft" || !permissions.can("update", "purchasing");

  return (
    <>
      <SetupSection
        title={<Trans>Accounting Treatment</Trans>}
        description={
          <Trans>
            Decided for each asset when the lease is activated, from its payment
            rows and the inputs below.
          </Trans>
        }
      >
        <div className="w-full">
          <LeaseClassificationPreview
            lease={lease}
            lines={lines}
            payments={payments}
            policy={leasePolicy}
          />
        </div>
      </SetupSection>

      {/* An open-ended lease is short-term: nothing is discounted or
          classified, so it has no rate and no inputs to set. */}
      {lease.endDate && (
        <SetupSection
          title={<Trans>Discount Rate</Trans>}
          description={
            <Trans>The rate every asset's payments are discounted at.</Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <TermForm name="discountRate" value={lease.discountRate}>
              <NumberControlled
                name="discountRate"
                label={t`Discount Rate (%)`}
                helperText={t`Annual. Starts from the company's incremental borrowing rate`}
                isReadOnly={isDisabled}
                value={lease.discountRate ?? 0}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) => {
                  const next = String(Number.isNaN(value) ? 0 : value);
                  if (String(lease.discountRate) !== next) {
                    save("discountRate", next);
                  }
                }}
              />
            </TermForm>
          </div>
        </SetupSection>
      )}

      {lease.endDate && lines.length > 0 && (
        <SetupSection
          title={<Trans>Asset Inputs</Trans>}
          description={
            <Trans>
              What each asset is worth, how long it lasts, and what happens to
              it at the end of the term. A purchase option that is reasonably
              certain becomes a payment row. Click a cell to change it.
            </Trans>
          }
        >
          <LeaseAssetInputsGrid
            leaseId={id}
            currencyCode={lease.currencyCode ?? ""}
            lines={lines}
            isDisabled={isDisabled}
          />
        </SetupSection>
      )}
    </>
  );
};

/** One row per asset: its fair value, economic life, purchase option and
 *  the three switches the tests read, each saved through the asset's update
 *  route. */
function LeaseAssetInputsGrid({
  leaseId,
  currencyCode,
  lines,
  isDisabled
}: {
  leaseId: string;
  currencyCode: string;
  lines: LeaseLine[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const save = useCellSave();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const rows = useMemo<AssetInputRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        description: line.description,
        fairValue: line.fairValue === null ? null : Number(line.fairValue),
        economicLifeMonths: line.economicLifeMonths,
        purchaseOptionAmount:
          line.purchaseOptionAmount === null
            ? null
            : Number(line.purchaseOptionAmount),
        purchaseOptionReasonablyCertain: asSwitch(
          line.purchaseOptionReasonablyCertain
        ),
        ownershipTransfers: asSwitch(line.ownershipTransfers),
        specializedAsset: asSwitch(line.specializedAsset)
      })),
    [lines]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: AssetInputRow) =>
      save(path.to.leaseLineUpdate(leaseId, row.id), {
        field: accessorKey,
        // An emptied number commits NaN (and 0 means none): no value is
        // null, not 0.
        value:
          value === null ||
          value === undefined ||
          (typeof value === "number" && (Number.isNaN(value) || value <= 0))
            ? ""
            : String(value)
      }),
    [leaseId, save]
  );

  const money = useCallback(
    (value: number | null) =>
      value === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Money value={value} currencyCode={currencyCode} />
      ),
    [currencyCode]
  );
  const yesNo = useCallback(
    (value: Switch) =>
      value === "on" ? (
        <Trans>Yes</Trans>
      ) : (
        <span className="text-muted-foreground">
          <Trans>No</Trans>
        </span>
      ),
    []
  );

  const columns = useMemo<ColumnDef<AssetInputRow>[]>(
    () => [
      {
        accessorKey: "description",
        header: t`Asset`,
        cell: ({ row }) => (
          <span className="block max-w-[220px] truncate font-medium">
            {row.original.description}
          </span>
        )
      },
      {
        accessorKey: "fairValue",
        header: t`Fair Value`,
        cell: ({ row }) => money(row.original.fairValue)
      },
      {
        accessorKey: "economicLifeMonths",
        header: t`Economic Life (months)`,
        cell: ({ row }) =>
          row.original.economicLifeMonths === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {row.original.economicLifeMonths}
            </span>
          )
      },
      {
        accessorKey: "purchaseOptionAmount",
        header: t`Purchase Option`,
        cell: ({ row }) => money(row.original.purchaseOptionAmount)
      },
      {
        accessorKey: "purchaseOptionReasonablyCertain",
        header: t`Reasonably Certain`,
        cell: ({ row }) => yesNo(row.original.purchaseOptionReasonablyCertain)
      },
      {
        accessorKey: "ownershipTransfers",
        header: t`Ownership Transfers`,
        cell: ({ row }) => yesNo(row.original.ownershipTransfers)
      },
      {
        accessorKey: "specializedAsset",
        header: t`Specialized`,
        cell: ({ row }) => yesNo(row.original.specializedAsset)
      }
    ],
    [t, money, yesNo]
  );

  const editableComponents = useMemo(() => {
    const moneyCell = EditableNumber<AssetInputRow>(onCellEdit, {
      minValue: 0,
      step: INPUT_STEP.money(currencyDecimals),
      formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
    });
    const switchCell = EditableList<AssetInputRow>(onCellEdit, [
      { value: "on", label: t`Yes` },
      { value: "off", label: t`No` }
    ]);
    return {
      fairValue: moneyCell,
      economicLifeMonths: EditableNumber<AssetInputRow>(onCellEdit, {
        minValue: 1
      }),
      purchaseOptionAmount: moneyCell,
      purchaseOptionReasonablyCertain: switchCell,
      ownershipTransfers: switchCell,
      specializedAsset: switchCell
    };
  }, [onCellEdit, currencyCode, currencyDecimals, t]);

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(rows.length) }}
    >
      <Table<AssetInputRow>
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        withInlineEditing={!isDisabled}
        forceEditMode={!isDisabled}
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
}

export default LeaseAccounting;
