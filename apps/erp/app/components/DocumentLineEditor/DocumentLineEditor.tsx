import { Status } from "@carbon/react";
import { EPSILON } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useCurrencyFormatter } from "~/hooks";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";
import DocumentLineRow from "./DocumentLineRow";
import type { ClientDocumentLine } from "./types";

type DocumentLineEditorProps = {
  /** The form field name for the hidden JSON payload. Defaults to "lines". */
  name?: string;
  initialLines: ClientDocumentLine[];
  currencyCode: string;
  /** From getActiveDimensionsWithValues in the route loader. */
  availableDimensions: DimensionWithValues[];
  /** The document header amount the lines must sum to. */
  headerAmount: number;
  isDisabled?: boolean;
  /** Notified on every change so the page header can show the running total. */
  onTotalChange?: (total: number, isBalanced: boolean) => void;
};

function generateKey() {
  return Math.random().toString(36).substring(2, 9);
}

function createEmptyLine(): ClientDocumentLine {
  return {
    key: generateKey(),
    accountId: "",
    description: "",
    amount: null,
    dimensions: [],
    costCenterId: null,
    projectId: null
  };
}

/**
 * The coding-line editor shared by every imported spend document — charges and
 * reimbursements alike (`.ai/specs/2026-09-23-editable-imported-spend-documents.md`).
 * It knows nothing about either document: it takes lines, a currency and the
 * header amount, and emits ONE hidden JSON field the route action parses.
 */
const DocumentLineEditor = ({
  name = "lines",
  initialLines,
  currencyCode,
  availableDimensions,
  headerAmount,
  isDisabled = false,
  onTotalChange
}: DocumentLineEditorProps) => {
  const { t } = useLingui();
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

  const [lines, setLines] = useState<ClientDocumentLine[]>(() =>
    initialLines.length === 0 ? [createEmptyLine()] : initialLines
  );
  // A freshly-imported line is worth reading in full, so every row that came
  // from the document starts expanded; new ones do too.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(lines.map((line) => line.key))
  );

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
    [lines]
  );
  // EPSILON, not a cent. `requireLineSum` in the post-reimbursement edge
  // function compares the line sum to the header with `EPSILON` (1e-6) — its
  // BALANCE_TOLERANCE of 0.01 governs the journal's debit/credit residual, a
  // different question. A looser threshold here would let the editor call a
  // document Balanced that the edge function then refuses with a raw error,
  // which is precisely what this guard exists to prevent.
  const isBalanced = Math.abs(total - headerAmount) <= EPSILON;

  useEffect(() => {
    onTotalChange?.(total, isBalanced);
  }, [total, isBalanced, onTotalChange]);

  const handleLineChange = useCallback(
    (index: number, updatedLine: ClientDocumentLine) => {
      setLines((prev) => {
        const next = [...prev];
        next[index] = updatedLine;
        return next;
      });
    },
    []
  );

  const handleDeleteLine = useCallback((index: number) => {
    setLines((prev) => {
      // The document must always keep at least one coding line — the posting
      // path refuses a zero-line document.
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleAddLine = useCallback(() => {
    const line = createEmptyLine();
    setLines((prev) => [...prev, line]);
    setExpandedKeys((prev) => new Set(prev).add(line.key));
  }, []);

  const handleToggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The server contract is the id pair only: `key` is client-only and
  // JournalLineDimensionValue's display names are for rendering.
  const linesJson = JSON.stringify(
    lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      costCenterId: line.costCenterId,
      projectId: line.projectId,
      description: line.description,
      amount: line.amount ?? 0,
      dimensions: (line.dimensions ?? []).map(({ dimensionId, valueId }) => ({
        dimensionId,
        valueId
      }))
    }))
  );

  const addLineButton = (className: string) => (
    <button
      type="button"
      onClick={handleAddLine}
      className={className}
      disabled={isDisabled}
    >
      <LuPlus className="size-3.5" />
      <Trans>Add line item</Trans>
    </button>
  );

  return (
    <div className="rounded-lg border border-border overflow-hidden w-full">
      <input type="hidden" name={name} value={linesJson} />

      {/* Column headers */}
      <div className="grid grid-cols-[auto_1fr_160px_40px] items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border">
        <div className="w-10" />
        <div>
          <Trans>Account & Details</Trans>
        </div>
        <div className="text-right">
          <Trans>Amount</Trans>
        </div>
        <div />
      </div>

      {!isDisabled &&
        addLineButton(
          "flex w-full items-center justify-center gap-2 border-b border-dashed border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
        )}

      <div className="divide-y divide-border">
        {lines.map((line, index) => (
          <DocumentLineRow
            key={line.key}
            line={line}
            index={index}
            currencyCode={currencyCode}
            availableDimensions={availableDimensions}
            isExpanded={expandedKeys.has(line.key)}
            onToggleExpand={() => handleToggleExpand(line.key)}
            onChange={(updatedLine) => handleLineChange(index, updatedLine)}
            onDelete={() => handleDeleteLine(index)}
            canDelete={lines.length > 1}
            isDisabled={isDisabled}
          />
        ))}
      </div>

      {!isDisabled &&
        addLineButton(
          "flex w-full items-center justify-center gap-2 border-t border-dashed border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
        )}

      {/* Totals */}
      <div className="grid grid-cols-[auto_1fr_160px_40px] items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border">
        <div className="w-10" />
        <div className="flex items-center gap-2 text-sm font-medium">
          <Trans>Total</Trans>
          {isBalanced ? (
            <Status color="green">{t`Balanced`}</Status>
          ) : (
            <Status color="red">{t`Unbalanced`}</Status>
          )}
        </div>
        <div className="text-right font-mono text-sm tabular-nums">
          {currencyFormatter.format(total)}
        </div>
        <div />
      </div>
    </div>
  );
};

export default DocumentLineEditor;
