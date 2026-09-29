import { cn, IconButton, Input, NumberField, NumberInput } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { LuChevronRight, LuTrash } from "react-icons/lu";
import { AccountControlled } from "~/components/Form";
import { useCurrencyDecimals } from "~/hooks";
import DimensionSelector from "~/modules/accounting/ui/JournalEntries/DimensionSelector";
import type {
  DimensionWithValues,
  JournalLineDimensionValue
} from "~/modules/accounting/ui/JournalEntries/types";
import type { ClientDocumentLine } from "./types";

type DocumentLineRowProps = {
  line: ClientDocumentLine;
  index: number;
  currencyCode: string;
  availableDimensions: DimensionWithValues[];
  /** Collapsed rows show account + amount only; expanded adds the rest. */
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChange: (line: ClientDocumentLine) => void;
  onDelete: () => void;
  canDelete: boolean;
  isDisabled: boolean;
};

const DocumentLineRow = ({
  line,
  index,
  currencyCode,
  availableDimensions,
  isExpanded,
  onToggleExpand,
  onChange,
  onDelete,
  canDelete,
  isDisabled
}: DocumentLineRowProps) => {
  const { t } = useLingui();
  // A coding line's amount is a SETTLEMENT amount — what the document is worth
  // — so it formats and steps at the currency's own decimals, never a literal.
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const handleDimensionsChange = (dimensions: JournalLineDimensionValue[]) => {
    onChange({ ...line, dimensions });
  };

  return (
    <div className="group">
      <div className="grid grid-cols-[auto_1fr_160px_40px] items-start gap-3 py-4 px-4 transition-colors hover:bg-muted/30">
        {/* Expand toggle + row number */}
        <div className="flex h-9 items-center gap-1">
          <IconButton
            type="button"
            aria-label={isExpanded ? t`Collapse line` : t`Expand line`}
            icon={
              <LuChevronRight
                className={cn(
                  "transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
            }
            variant="ghost"
            onClick={onToggleExpand}
            className="size-6 p-0 text-muted-foreground"
          />
          <span className="w-4 text-xs font-medium text-muted-foreground tabular-nums">
            {index + 1}
          </span>
        </div>

        {/* Account, description and dimensions */}
        <div className="space-y-2">
          <AccountControlled
            value={line.accountId}
            onChange={(accountId) => onChange({ ...line, accountId })}
            placeholder={t`Select account`}
            isReadOnly={isDisabled}
          />

          {isExpanded && (
            <>
              <Input
                placeholder={t`Line description (optional)`}
                value={line.description}
                onChange={(e) =>
                  onChange({ ...line, description: e.target.value })
                }
                isReadOnly={isDisabled}
                size="sm"
              />

              {availableDimensions.length > 0 && (
                <DimensionSelector
                  journalLineId={line.key}
                  availableDimensions={availableDimensions}
                  currentDimensions={line.dimensions}
                  onChange={handleDimensionsChange}
                  autoSave={false}
                />
              )}
            </>
          )}
        </div>

        {/* Amount */}
        <NumberField
          value={line.amount ?? 0}
          onChange={(value) =>
            onChange({ ...line, amount: isNaN(value) ? null : value })
          }
          formatOptions={INPUT_FORMAT.money(currencyCode, currencyDecimals)}
          step={INPUT_STEP.money(currencyDecimals)}
          minValue={0}
          isDisabled={isDisabled}
          isReadOnly={isDisabled}
        >
          <NumberInput
            className="text-right font-mono tabular-nums"
            isReadOnly={isDisabled}
          />
        </NumberField>

        {/* Delete */}
        <div className="flex h-9 items-center justify-center">
          {!isDisabled && (
            <IconButton
              type="button"
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

export default DocumentLineRow;
