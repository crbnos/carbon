// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { LabelWithHelp, Status } from "@carbon/react";
import { isBalanced } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { create } from "zustand";
import { DatePicker, Hidden, Input, Select } from "~/components/Form";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  JOURNAL_BALANCE_TOLERANCE,
  journalEntrySourceTypes,
  journalEntryValidator
} from "../../accounting.models";
import JournalLineRow, {
  journalLineCell,
  journalLineGridClassName
} from "./JournalLineRow";
import type {
  ClientJournalLine,
  DimensionWithValues,
  JournalLineDimensionValue
} from "./types";

/** The header's Post button submits this form, lines and all. */
export const journalEntryFormId = "journal-entry-form";

// Whether the entry being edited can be posted — balanced, with at least one
// debit. The lines live in the form; the header's Post button reads this.
const usePostableStore = create<{
  postable: { journalEntryId: string; canPost: boolean } | null;
}>()(() => ({ postable: null }));

export function useJournalEntryCanPost(journalEntryId: string) {
  const postable = usePostableStore((state) => state.postable);
  return postable?.journalEntryId === journalEntryId && postable.canPost;
}

type JournalEntryFormProps = {
  journalEntryId: string;
  status: string;
  sourceType: string;
  initialValues: {
    id: string;
    companyId: string;
    sourceType: string;
    postingDate: string;
    description: string;
  };
  initialLines: ClientJournalLine[];
  companies: { id: string; name: string }[];
  dimensions: DimensionWithValues[];
  lineDimensions: Record<string, JournalLineDimensionValue[]>;
  isDisabled?: boolean;
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function createEmptyLine(): ClientJournalLine {
  return {
    id: generateId(),
    accountId: "",
    description: "",
    debit: null,
    credit: null,
    dimensions: []
  };
}

/**
 * The entry's own fields and its lines, laid flat under its header. Posting
 * locks everything but the lines' dimensions.
 */
const JournalEntryForm = ({
  journalEntryId,
  status,
  sourceType,
  initialValues,
  initialLines,
  companies,
  dimensions,
  lineDimensions,
  isDisabled = false
}: JournalEntryFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const [lines, setLines] = useState<ClientJournalLine[]>(() => {
    if (initialLines.length === 0) {
      return [createEmptyLine(), createEmptyLine()];
    }
    return initialLines.map((line) => ({
      ...line,
      dimensions: lineDimensions[line.id] ?? line.dimensions ?? []
    }));
  });
  const isPosted = status === "Posted";
  const isReversed = status === "Reversed";

  const companyName = useMemo(
    () => companies.find((c) => c.id === initialValues.companyId)?.name ?? "",
    [companies, initialValues.companyId]
  );

  const sourceTypeOptions = journalEntrySourceTypes.map((type) => ({
    label: type,
    value: type
  }));

  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const difference = totalDebits - totalCredits;
  // The server's own test: an entry the form calls balanced posts.
  const balanced = isBalanced(
    totalDebits,
    totalCredits,
    JOURNAL_BALANCE_TOLERANCE
  );
  const canPost = balanced && totalDebits !== 0;

  useEffect(() => {
    usePostableStore.setState({ postable: { journalEntryId, canPost } });
  }, [journalEntryId, canPost]);

  const handleLineChange = useCallback(
    (index: number, updatedLine: ClientJournalLine) => {
      setLines((prev) => {
        const newLines = [...prev];
        newLines[index] = updatedLine;
        return newLines;
      });
    },
    []
  );

  const handleDeleteLine = useCallback((index: number) => {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleAddLine = useCallback(() => {
    setLines((prev) => [...prev, createEmptyLine()]);
  }, []);

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      // A stored line's id, so the save edits it in place; a new line's
      // client id matches nothing and is inserted.
      id: l.id,
      accountId: l.accountId,
      description: l.description,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      dimensions: (l.dimensions ?? []).map((d) => ({
        dimensionId: d.dimensionId,
        valueId: d.valueId
      }))
    }))
  );

  return (
    <ValidatedForm
      id={journalEntryFormId}
      method="post"
      validator={journalEntryValidator}
      defaultValues={initialValues}
      isReadOnly={isDisabled}
      className="flex flex-col gap-4 w-full pt-2 pb-4"
    >
      {/* Each Hidden renders a wrapper; keep them out of the flex gap. */}
      <div className="hidden">
        <Hidden name="id" />
        <input type="hidden" name="lines" value={linesJson} />
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-3 gap-x-8 gap-y-4 w-full">
        <div className="col-span-full">
          <Input autoFocus name="description" label={t`Description`} />
        </div>
        <Input
          name="company"
          label={t`Company`}
          value={companyName}
          isReadOnly
        />
        <Select
          name="sourceType"
          label={t`Source`}
          termId="journal-entry-source"
          value={sourceType}
          options={sourceTypeOptions}
          isReadOnly
        />
        <DatePicker
          name="postingDate"
          label={t`Posting Date`}
          termId="journal-entry-posting-date"
          isDisabled={isDisabled}
        />
      </div>

      {/* Journal Lines + Totals */}
      <div className="@container rounded-lg border border-border overflow-hidden w-full">
        {/* Column Headers */}
        <div
          className={`${journalLineGridClassName} items-center px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
        >
          <div className={`${journalLineCell.number} w-6`} />
          <div className={`${journalLineCell.details} pl-3 truncate`}>
            <Trans>Account & Details</Trans>
          </div>
          <div
            className={`${journalLineCell.debit} ${journalLineCell.wideOnly} text-right pr-3`}
          >
            <LabelWithHelp
              variant="inline"
              termId="journal-line-debit"
              className="justify-end"
            >
              <Trans>Debit</Trans>
            </LabelWithHelp>
          </div>
          <div
            className={`${journalLineCell.credit} ${journalLineCell.wideOnly} text-right pr-3`}
          >
            <LabelWithHelp
              variant="inline"
              termId="journal-line-credit"
              className="justify-end"
            >
              <Trans>Credit</Trans>
            </LabelWithHelp>
          </div>
        </div>

        {/* Lines */}
        <div className="divide-y divide-border">
          {lines.map((line, index) => (
            <JournalLineRow
              key={line.id}
              line={line}
              index={index}
              currencyCode={company.baseCurrencyCode}
              onChange={(updatedLine) => handleLineChange(index, updatedLine)}
              onDelete={() => handleDeleteLine(index)}
              canDelete={lines.length > 2}
              isDisabled={isDisabled}
              availableDimensions={dimensions}
              autoSaveDimensions={isPosted || isReversed}
            />
          ))}
        </div>

        {/* Add Line Button */}
        {!isDisabled && (
          <button
            type="button"
            onClick={handleAddLine}
            className="flex w-full items-center justify-center gap-2 border-t border-dashed border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
          >
            <LuPlus className="size-3.5" />
            <Trans>Add Line</Trans>
          </button>
        )}

        {/* Totals */}
        <div
          className={`${journalLineGridClassName} items-center px-4 py-3 bg-muted/50 border-t border-border`}
        >
          <div className={`${journalLineCell.number} w-6`} />
          <div
            className={`${journalLineCell.details} flex flex-wrap items-center gap-2 text-sm font-medium`}
          >
            <Trans>Totals</Trans>
            {balanced && totalDebits > 0 ? (
              <Status color="green">
                <Trans>Balanced</Trans>
              </Status>
            ) : totalDebits === 0 && totalCredits === 0 ? (
              <Status color="yellow">
                <Trans>Enter at least one debit and credit</Trans>
              </Status>
            ) : (
              <Status color="yellow">
                <Trans>Unbalanced</Trans>
                {totalDebits > 0 && (
                  <span className="ml-1 font-normal">
                    ({currencyFormatter.format(Math.abs(difference))}{" "}
                    {difference > 0 ? t`more debits` : t`more credits`})
                  </span>
                )}
              </Status>
            )}
          </div>
          <div
            className={`${journalLineCell.debit} text-right font-mono text-sm tabular-nums truncate`}
          >
            <div className={journalLineCell.narrowLabel}>
              <Trans>Debit</Trans>
            </div>
            {currencyFormatter.format(totalDebits)}
          </div>
          <div
            className={`${journalLineCell.credit} text-right font-mono text-sm tabular-nums truncate`}
          >
            <div className={journalLineCell.narrowLabel}>
              <Trans>Credit</Trans>
            </div>
            {currencyFormatter.format(totalCredits)}
          </div>
        </div>
      </div>
    </ValidatedForm>
  );
};

export default JournalEntryForm;
