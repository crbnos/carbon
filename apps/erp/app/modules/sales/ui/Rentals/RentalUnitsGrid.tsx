// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MultiSelect, Select, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuInfo, LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import { EditableList, EditableNumber } from "~/components/Editable";
import { Submit } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  rentalAgreementLinesAddValidator,
  rentalRateUnits
} from "../../sales.models";
import RentalMoney from "./RentalMoney";
import type {
  RentableFleetAsset,
  RentalAgreement,
  RentalAgreementLine
} from "./types";
import { rentalUnitLabel } from "./useRentalLineActions";

type RateUnit = (typeof rentalRateUnits)[number];

type UnitRow = {
  id: string;
  unit: string;
  name: string | null;
  readableId: string | null;
  serialNumber: string | null;
  rateUnit: RateUnit;
  rate: number;
};

type RentalUnitsGridProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  rentableAssets: RentableFleetAsset[];
};

/** The agreement's fleet units as a spreadsheet: each unit's rate frequency
 *  and rate edit in place, one cell at a time, through the line's update
 *  route. A new frequency starts from its own rate on file. */
const RentalUnitsGrid = ({
  rentalAgreement,
  lines,
  rentableAssets
}: RentalUnitsGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();

  const agreementId = rentalAgreement.id!;
  const currencyCode = rentalAgreement.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const canEdit = permissions.can("update", "sales");

  const addUnits = useDisclosure();
  const [deleting, setDeleting] = useState<RentalAgreementLine | null>(null);

  const rateUnitLabels = useMemo<Record<RateUnit, string>>(
    () => ({ Day: t`Daily`, Week: t`Weekly`, Month: t`Monthly` }),
    [t]
  );

  const rows = useMemo<UnitRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        unit: line.fixedAsset?.fixedAssetId ?? rentalUnitLabel(line),
        name: line.fixedAsset?.name ?? null,
        readableId: line.item?.readableIdWithRevision ?? null,
        serialNumber: line.fixedAsset?.serialNumber ?? null,
        rateUnit: line.rateUnit,
        rate: Number(line.rate)
      })),
    [lines]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: UnitRow) =>
      save(path.to.rentalAgreementLineUpdate(agreementId, row.id), {
        field: accessorKey,
        value: value === null || value === undefined ? "" : String(value)
      }),
    [agreementId, save]
  );

  const columns = useMemo<ColumnDef<UnitRow>[]>(
    () => [
      {
        accessorKey: "unit",
        header: t`Fleet Unit`,
        cell: ({ row }) => (
          <div className="flex max-w-[240px] flex-col">
            <span className="truncate font-medium">{row.original.unit}</span>
            {row.original.name && (
              <span className="truncate text-xs text-muted-foreground">
                {row.original.name}
              </span>
            )}
          </div>
        )
      },
      {
        accessorKey: "readableId",
        header: t`Item`,
        cell: ({ row }) =>
          row.original.readableId ?? (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "serialNumber",
        header: t`Serial Number`,
        cell: ({ row }) =>
          row.original.serialNumber ?? (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "rateUnit",
        header: t`Rate Frequency`,
        cell: ({ row }) => rateUnitLabels[row.original.rateUnit]
      },
      {
        accessorKey: "rate",
        header: t`Rate`,
        cell: ({ row }) =>
          row.original.rate > 0 ? (
            <RentalMoney
              value={row.original.rate}
              currencyCode={currencyCode}
              rate
            />
          ) : (
            <span className="text-red-500">
              <Trans>No rate</Trans>
            </span>
          )
      }
    ],
    [t, currencyCode, rateUnitLabels]
  );

  const editableComponents = useMemo(
    () => ({
      rateUnit: EditableList<UnitRow>(
        onCellEdit,
        rentalRateUnits.map((value) => ({
          value,
          label: rateUnitLabels[value]
        }))
      ),
      rate: EditableNumber<UnitRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.rate,
        formatOptions: INPUT_FORMAT.rate(currencyCode, currencyDecimals)
      })
    }),
    [onCellEdit, currencyCode, currencyDecimals, rateUnitLabels]
  );

  const renderRowMenu = useCallback(
    (row: UnitRow) => {
      const line = lines.find((l) => l.id === row.id);
      if (!line) return null;
      return (
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.delete}
          destructive
          disabled={!permissions.can("delete", "sales")}
          onClick={() => setDeleting(line)}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Remove Unit</Trans>
        </MenuItem>
      );
    },
    [lines, permissions]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderRowMenu, t`Actions`)],
    [columns, renderRowMenu, t]
  );

  const canAdd = permissions.can("create", "sales");

  return (
    <div className="flex w-full flex-col gap-4">
      {rows.length === 0 && rentableAssets.length === 0 && <FleetUnitsHint />}
      {rows.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans>
              No units yet. Add the fleet units this agreement rents.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!canAdd || rentableAssets.length === 0}
            onClick={addUnits.onOpen}
          >
            <Trans>Add Units</Trans>
          </Button>
        </div>
      ) : (
        <>
          <div
            className="w-full overflow-hidden rounded-lg border border-border"
            style={{
              height: setupGridHeight(
                rows.length,
                rows.some((row) => row.name) ? 53 : 49
              )
            }}
          >
            <Table<UnitRow>
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
          <div>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!canAdd || rentableAssets.length === 0}
              onClick={addUnits.onOpen}
            >
              <Trans>Add Units</Trans>
            </Button>
          </div>
        </>
      )}

      {addUnits.isOpen && (
        <RentalAddUnitsModal
          rentalAgreementId={agreementId}
          rentableAssets={rentableAssets}
          rateUnitLabels={rateUnitLabels}
          onClose={addUnits.onClose}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreementLine(agreementId, deleting.id)}
          name={rentalUnitLabel(deleting)}
          text={t`Are you sure you want to remove ${rentalUnitLabel(deleting)} from this agreement?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

/** Pick several fleet units at once; each becomes a line at its rate on
 *  file for the chosen frequency, to be adjusted in the grid. */
const RentalAddUnitsModal = ({
  rentalAgreementId,
  rentableAssets,
  rateUnitLabels,
  onClose
}: {
  rentalAgreementId: string;
  rentableAssets: RentableFleetAsset[];
  rateUnitLabels: Record<RateUnit, string>;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);

  const options = useMemo(
    () =>
      rentableAssets.map((asset) => ({
        value: asset.id!,
        label: [asset.fixedAssetId, asset.name].filter(Boolean).join(" · "),
        helper: [asset.itemReadableId, asset.serialNumber]
          .filter(Boolean)
          .join(" · ")
      })),
    [rentableAssets]
  );

  // The action redirects back with a flash; close once it has settled.
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={rentalAgreementLinesAddValidator}
          method="post"
          action={path.to.rentalAgreementLinesAdd(rentalAgreementId)}
          fetcher={fetcher}
          defaultValues={{ fixedAssetIds: [], rateUnit: "Month" }}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Units</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Choose the fleet units this agreement rents. Each starts at its
                rate on file for the frequency; change it in the grid.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <FleetUnitsHint />
              <MultiSelect
                name="fixedAssetIds"
                label={t`Fleet Units`}
                options={options}
              />
              <Select
                name="rateUnit"
                label={t`Rate Frequency`}
                options={rentalRateUnits.map((value) => ({
                  value,
                  label: rateUnitLabels[value]
                }))}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              isDisabled={fetcher.state !== "idle"}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

/** Why a serial number may be missing from the list, and how to add it. */
const FleetUnitsHint = () => (
  <Alert variant="info">
    <LuInfo className="h-4 w-4" />
    <AlertTitle>
      <Trans>Don't see a serial number?</Trans>
    </AlertTitle>
    <AlertDescription>
      <Trans>
        Only serialized units capitalized as fixed assets can be rented. To add
        one, open the part's Inventory tab, find the serial number under Storage
        Units, and choose Capitalize as Fixed Asset.
      </Trans>
    </AlertDescription>
  </Alert>
);

export default RentalUnitsGrid;
