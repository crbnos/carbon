// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { Link } from "react-router";
import { Table } from "~/components";
import { EditableNumber } from "~/components/Editable";
import { Boolean, NumberControlled } from "~/components/Form";
import {
  SetupSection,
  setupGridHeight,
  TermForm,
  useCellSave
} from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { LeasePolicy } from "../../sales.utils";
import { LeaseClassificationPreview } from "./RentalLeaseClassification";
import RentalMoney from "./RentalMoney";
import { type RentalTerm, useRentalTermSave } from "./RentalSetupSteps";
import type {
  RentalAgreement,
  RentalAgreementLine,
  RentalLeaseLineInputs
} from "./types";
import { rentalUnitLabel } from "./useRentalLineActions";

type UnitInputRow = {
  id: string;
  unit: string;
  fairValue: number | null;
  economicLifeMonths: number | null;
  guaranteedResidualValue: number;
  unguaranteedResidualValue: number;
};

type RentalAgreementAccountingProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  leaseInputs: Record<string, RentalLeaseLineInputs>;
  leasePolicy: LeasePolicy;
};

/** Whether each unit is a rental or, in substance, a sale (ASC 842): the
 *  terms that decide it, each unit's fair value and life, and the live
 *  result. Every field saves on its own; activation classifies for good. */
const RentalAgreementAccounting = ({
  rentalAgreement,
  lines,
  leaseInputs,
  leasePolicy
}: RentalAgreementAccountingProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const id = rentalAgreement.id!;
  const currencyCode = rentalAgreement.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const { save } = useRentalTermSave(id);
  const isDisabled =
    rentalAgreement.status !== "Draft" || !permissions.can("update", "sales");
  const hasEndDate = !!rentalAgreement.endDate;
  const hasPurchaseOption = (rentalAgreement.purchaseOptionAmount ?? 0) > 0;

  const onChange = (field: RentalTerm, value: string | null) => {
    const current = rentalAgreement[field];
    if ((current ?? null) === (value ?? null) || String(current) === value) {
      return;
    }
    save(field, value);
  };
  const onSwitch = (field: RentalTerm, value: boolean) => {
    if (!!rentalAgreement[field] === value) return;
    save(field, value ? "on" : "off");
  };

  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);

  return (
    <>
      <SetupSection
        title={<Trans>Accounting Treatment</Trans>}
        description={
          <Trans>
            Whether each unit is treated as a rental or a sale is decided when
            the agreement is activated, from these terms and each unit's inputs.
          </Trans>
        }
      >
        <div className="w-full">
          <LeaseClassificationPreview
            terms={{
              startDate: rentalAgreement.startDate ?? "",
              endDate: rentalAgreement.endDate ?? null,
              billingCycle: rentalAgreement.billingCycle ?? "Calendar Month",
              billingTiming: rentalAgreement.billingTiming ?? "Advance",
              discountRate: Number(rentalAgreement.discountRate ?? 0),
              ownershipTransfers: rentalAgreement.ownershipTransfers ?? false,
              specializedAsset: rentalAgreement.specializedAsset ?? false,
              purchaseOptionAmount:
                rentalAgreement.purchaseOptionAmount ?? null,
              purchaseOptionReasonablyCertain:
                hasPurchaseOption &&
                (rentalAgreement.purchaseOptionReasonablyCertain ?? false)
            }}
            lines={lines}
            leaseInputs={leaseInputs}
            policy={leasePolicy}
          />
        </div>
        {!hasEndDate && (
          <p className="text-sm text-muted-foreground">
            <Trans>
              To test whether it is a sale,{" "}
              <Link
                to={path.to.rentalAgreementSetup(id, "details")}
                className="underline"
              >
                give the agreement a fixed term
              </Link>
              .
            </Trans>
          </p>
        )}
      </SetupSection>

      {hasEndDate && (
        <SetupSection
          title={<Trans>End of Term</Trans>}
          description={
            <Trans>
              What happens to the units when the term ends, and the rate the
              rent is discounted at.
            </Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <TermForm name="discountRate" value={rentalAgreement.discountRate}>
              <NumberControlled
                name="discountRate"
                label={t`Discount Rate (%)`}
                helperText={t`Annual rate the rent is discounted at`}
                isReadOnly={isDisabled}
                value={rentalAgreement.discountRate ?? 0}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
                onChange={(value) =>
                  onChange(
                    "discountRate",
                    String(Number.isNaN(value) ? 0 : value)
                  )
                }
              />
            </TermForm>
            <TermForm
              name="purchaseOptionAmount"
              value={rentalAgreement.purchaseOptionAmount}
            >
              <NumberControlled
                name="purchaseOptionAmount"
                label={t`Purchase Option`}
                helperText={t`What the customer can buy each unit for at the end`}
                isReadOnly={isDisabled}
                value={rentalAgreement.purchaseOptionAmount ?? 0}
                minValue={0}
                step={moneyStep}
                formatOptions={moneyFormat}
                onChange={(value) =>
                  // An emptied input commits NaN; no option is null, not 0.
                  onChange(
                    "purchaseOptionAmount",
                    value > 0 ? String(value) : null
                  )
                }
              />
            </TermForm>
            <div className="flex flex-col gap-4 md:col-span-2">
              {hasPurchaseOption && (
                <TermForm
                  name="purchaseOptionReasonablyCertain"
                  value={rentalAgreement.purchaseOptionReasonablyCertain}
                >
                  <Boolean
                    name="purchaseOptionReasonablyCertain"
                    label={t`Purchase option reasonably certain`}
                    description={t`The customer is expected to buy the unit at the end of the term.`}
                    isDisabled={isDisabled}
                    bordered
                    onChange={(value) =>
                      onSwitch("purchaseOptionReasonablyCertain", value)
                    }
                  />
                </TermForm>
              )}
              <TermForm
                name="ownershipTransfers"
                value={rentalAgreement.ownershipTransfers}
              >
                <Boolean
                  name="ownershipTransfers"
                  label={t`Ownership transfers`}
                  description={t`Title passes to the customer when the term ends.`}
                  isDisabled={isDisabled}
                  bordered
                  onChange={(value) => onSwitch("ownershipTransfers", value)}
                />
              </TermForm>
              <TermForm
                name="specializedAsset"
                value={rentalAgreement.specializedAsset}
              >
                <Boolean
                  name="specializedAsset"
                  label={t`Specialized asset`}
                  description={t`The unit has no other use to you once the term ends.`}
                  isDisabled={isDisabled}
                  bordered
                  onChange={(value) => onSwitch("specializedAsset", value)}
                />
              </TermForm>
            </div>
          </div>
        </SetupSection>
      )}

      {hasEndDate && lines.length > 0 && (
        <SetupSection
          title={<Trans>Unit Inputs</Trans>}
          description={
            <Trans>
              Each unit's fair value and economic life decide whether the term
              covers most of it. Click a cell to change it.
            </Trans>
          }
        >
          <RentalUnitInputsGrid
            rentalAgreementId={id}
            currencyCode={currencyCode}
            lines={lines}
            isDisabled={isDisabled}
          />
        </SetupSection>
      )}
    </>
  );
};

/** One row per unit: its fair value, economic life and residual values, each
 *  saved through the line's update route. */
function RentalUnitInputsGrid({
  rentalAgreementId,
  currencyCode,
  lines,
  isDisabled
}: {
  rentalAgreementId: string;
  currencyCode: string;
  lines: RentalAgreementLine[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const save = useCellSave();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const rows = useMemo<UnitInputRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        unit: rentalUnitLabel(line),
        fairValue: line.fairValue,
        economicLifeMonths: line.economicLifeMonths,
        guaranteedResidualValue: Number(line.guaranteedResidualValue ?? 0),
        unguaranteedResidualValue: Number(line.unguaranteedResidualValue ?? 0)
      })),
    [lines]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: UnitInputRow) =>
      save(path.to.rentalAgreementLineUpdate(rentalAgreementId, row.id), {
        field: accessorKey,
        value:
          value === null ||
          value === undefined ||
          (typeof value === "number" && Number.isNaN(value))
            ? ""
            : String(value)
      }),
    [rentalAgreementId, save]
  );

  const money = useCallback(
    (value: number | null) =>
      value === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <RentalMoney value={value} currencyCode={currencyCode} />
      ),
    [currencyCode]
  );

  const columns = useMemo<ColumnDef<UnitInputRow>[]>(
    () => [
      {
        accessorKey: "unit",
        header: t`Fleet Unit`,
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate font-medium">
            {row.original.unit}
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
        accessorKey: "guaranteedResidualValue",
        header: t`Guaranteed Residual`,
        cell: ({ row }) => money(row.original.guaranteedResidualValue)
      },
      {
        accessorKey: "unguaranteedResidualValue",
        header: t`Unguaranteed Residual`,
        cell: ({ row }) => money(row.original.unguaranteedResidualValue)
      }
    ],
    [t, money]
  );

  const editableComponents = useMemo(() => {
    const moneyCell = EditableNumber<UnitInputRow>(onCellEdit, {
      minValue: 0,
      step: INPUT_STEP.money(currencyDecimals),
      formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
    });
    return {
      fairValue: moneyCell,
      economicLifeMonths: EditableNumber<UnitInputRow>(onCellEdit, {
        minValue: 1
      }),
      guaranteedResidualValue: moneyCell,
      unguaranteedResidualValue: moneyCell
    };
  }, [onCellEdit, currencyCode, currencyDecimals]);

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(rows.length) }}
    >
      <Table<UnitInputRow>
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

export default RentalAgreementAccounting;
