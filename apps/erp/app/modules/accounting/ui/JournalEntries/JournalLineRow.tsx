// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton, Input, NumberField, NumberInput } from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTrash } from "react-icons/lu";
import { AccountControlled } from "~/components/Form";
import { useCurrencyDecimals } from "~/hooks";
import DimensionSelector from "./DimensionSelector";
import type {
  ClientJournalLine,
  DimensionWithValues,
  JournalLineDimensionValue
} from "./types";

/**
 * The grid shared by the line rows, the column headers and the totals, sized
 * by the lines card (an `@container`), not the viewport — the content pane is
 * resizable.
 *
 * - From 40rem: one row — number, account & details, debit, credit, delete.
 *   Each amount column is up to 176px, room for "$12,345,678.00" in the mono
 *   input font (~118px) plus padding; grid fills a fixed maximum before a 1fr
 *   track gets the rest, so the account gives way, never below 10rem.
 * - Narrower: the account & details span the row, and debit and credit sit
 *   side by side beneath them, each labelled. A single row there leaves the
 *   account a sliver and clips everything in it.
 */
export const journalLineGridClassName =
  "grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_32px] gap-x-3 gap-y-2 @min-[40rem]:grid-cols-[auto_minmax(10rem,1fr)_minmax(0,176px)_minmax(0,176px)_32px] @min-[40rem]:gap-3";

/** Where each cell sits in `journalLineGridClassName`, narrow then wide. */
export const journalLineCell = {
  number: "col-start-1 row-start-1",
  details: "col-start-2 col-span-2 row-start-1 @min-[40rem]:col-span-1 min-w-0",
  debit:
    "col-start-2 row-start-2 @min-[40rem]:col-start-3 @min-[40rem]:row-start-1 min-w-0",
  credit:
    "col-start-3 row-start-2 @min-[40rem]:col-start-4 @min-[40rem]:row-start-1 min-w-0",
  actions: "col-start-4 row-start-1 @min-[40rem]:col-start-5",
  /** The Debit / Credit captions a narrow row shows above its amounts. */
  narrowLabel:
    "mb-1 font-sans text-xs font-medium text-muted-foreground @min-[40rem]:hidden",
  /** Header cells that only make sense as columns (wide). */
  wideOnly: "hidden @min-[40rem]:block"
} as const;

type JournalLineRowProps = {
  line: ClientJournalLine;
  index: number;
  currencyCode: string;
  onChange: (line: ClientJournalLine) => void;
  onDelete: () => void;
  canDelete: boolean;
  isDisabled: boolean;
  availableDimensions: DimensionWithValues[];
  autoSaveDimensions?: boolean;
};

const JournalLineRow = ({
  line,
  index,
  currencyCode,
  onChange,
  onDelete,
  canDelete,
  isDisabled,
  availableDimensions,
  autoSaveDimensions = false
}: JournalLineRowProps) => {
  const { t } = useLingui();
  // Debit/credit are GL journal lines — internal scale-5 values per the two-scale
  // rule, so the currency's decimals are the MINIMUM here, never the maximum.
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const handleAccountChange = (accountId: string) => {
    onChange({ ...line, accountId });
  };

  const handleDebitChange = (value: number) => {
    const numValue = isNaN(value) ? null : value;
    onChange({
      ...line,
      debit: numValue,
      credit: numValue !== null && numValue > 0 ? null : line.credit
    });
  };

  const handleCreditChange = (value: number) => {
    const numValue = isNaN(value) ? null : value;
    onChange({
      ...line,
      credit: numValue,
      debit: numValue !== null && numValue > 0 ? null : line.debit
    });
  };

  const handleDimensionsChange = (dimensions: JournalLineDimensionValue[]) => {
    onChange({ ...line, dimensions });
  };

  return (
    <div className="group">
      <div
        className={`${journalLineGridClassName} items-start py-4 px-4 transition-colors hover:bg-muted/30`}
      >
        {/* Row number */}
        <div
          className={`${journalLineCell.number} flex h-9 w-6 items-center justify-center text-xs font-medium text-muted-foreground tabular-nums`}
        >
          {index + 1}
        </div>

        {/* Account and Description */}
        <div className={`${journalLineCell.details} space-y-2`}>
          <AccountControlled
            value={line.accountId}
            onChange={handleAccountChange}
            placeholder={t`Select account`}
            isReadOnly={isDisabled}
          />

          <Input
            placeholder={t`Line description (optional)`}
            value={line.description}
            onChange={(e) => onChange({ ...line, description: e.target.value })}
            isReadOnly={isDisabled}
            size="sm"
          />

          {availableDimensions.length > 0 && (
            <DimensionSelector
              journalLineId={line.id}
              availableDimensions={availableDimensions}
              currentDimensions={line.dimensions}
              onChange={handleDimensionsChange}
              autoSave={autoSaveDimensions}
            />
          )}
        </div>

        {/* Debit */}
        <div className={journalLineCell.debit}>
          <div className={journalLineCell.narrowLabel}>
            <Trans>Debit</Trans>
          </div>
          <NumberField
            value={line.debit ?? 0}
            onChange={handleDebitChange}
            formatOptions={INPUT_FORMAT.rate(currencyCode, currencyDecimals)}
            minValue={0}
            isDisabled={isDisabled}
            isReadOnly={isDisabled}
          >
            <NumberInput
              className="text-right font-mono tabular-nums max-md:px-3"
              isReadOnly={isDisabled}
            />
          </NumberField>
        </div>

        {/* Credit */}
        <div className={journalLineCell.credit}>
          <div className={journalLineCell.narrowLabel}>
            <Trans>Credit</Trans>
          </div>
          <NumberField
            value={line.credit ?? 0}
            onChange={handleCreditChange}
            formatOptions={INPUT_FORMAT.rate(currencyCode, currencyDecimals)}
            minValue={0}
            isDisabled={isDisabled}
            isReadOnly={isDisabled}
          >
            <NumberInput
              className="text-right font-mono tabular-nums max-md:px-3"
              isReadOnly={isDisabled}
            />
          </NumberField>
        </div>

        {/* Delete button */}
        <div
          className={`${journalLineCell.actions} flex h-9 items-center justify-center`}
        >
          {!isDisabled && (
            <IconButton
              aria-label={t`Delete line`}
              icon={<LuTrash />}
              variant="ghost"
              onClick={onDelete}
              isDisabled={!canDelete}
              className="size-8 p-0 text-muted-foreground md:opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-0"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default JournalLineRow;
