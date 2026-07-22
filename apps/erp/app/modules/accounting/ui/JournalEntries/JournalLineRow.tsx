import { IconButton, Input, NumberField, NumberInput } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuTrash } from "react-icons/lu";
import { AccountControlled } from "~/components/Form";
import DimensionSelector from "./DimensionSelector";
import type {
  ClientJournalLine,
  DimensionWithValues,
  JournalLineDimensionValue
} from "./types";

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
      <div className="grid grid-cols-[auto_1fr_140px_140px_40px] items-start gap-3 py-4 px-4 transition-colors hover:bg-muted/30">
        {/* Row number */}
        <div className="flex h-9 w-6 items-center justify-center text-xs font-medium text-muted-foreground tabular-nums">
          {index + 1}
        </div>

        {/* Account and Description */}
        <div className="space-y-2">
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
        <NumberField
          value={line.debit ?? 0}
          onChange={handleDebitChange}
          formatOptions={{
            style: "currency",
            currency: currencyCode
          }}
          minValue={0}
          isDisabled={isDisabled}
          isReadOnly={isDisabled}
        >
          <NumberInput
            className="text-right font-mono tabular-nums"
            isReadOnly={isDisabled}
          />
        </NumberField>

        {/* Credit */}
        <NumberField
          value={line.credit ?? 0}
          onChange={handleCreditChange}
          formatOptions={{
            style: "currency",
            currency: currencyCode
          }}
          minValue={0}
          isDisabled={isDisabled}
          isReadOnly={isDisabled}
        >
          <NumberInput
            className="text-right font-mono tabular-nums"
            isReadOnly={isDisabled}
          />
        </NumberField>

        {/* Delete button */}
        <div className="flex h-9 items-center justify-center">
          {!isDisabled && (
            <IconButton
              aria-label={t`Delete line`}
              icon={<LuTrash />}
              variant="ghost"
              onClick={onDelete}
              isDisabled={!canDelete}
              className="size-8 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-0"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default JournalLineRow;
