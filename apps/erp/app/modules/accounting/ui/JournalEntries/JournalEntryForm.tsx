// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  LabelWithHelp,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import {
  LuCheckCheck,
  LuExternalLink,
  LuPlus,
  LuRotateCcw,
  LuSave,
  LuTrash
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { DocumentHeader } from "~/components";
import { DatePicker, Hidden, Input, Select } from "~/components/Form";
import {
  RecordAction,
  RecordHeroTarget
} from "~/components/Layout/RecordHeader";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import {
  journalEntrySourceTypes,
  journalEntryValidator
} from "../../accounting.models";
import JournalEntryStatus from "./JournalEntryStatus";
import JournalLineRow from "./JournalLineRow";
import type {
  ClientJournalLine,
  DimensionWithValues,
  JournalLineDimensionValue
} from "./types";

type JournalEntryFormProps = {
  journalEntryId: string;
  displayId: string;
  status: string;
  sourceType: string;
  sourceDocument?: { readableId: string; to: string } | null;
  reversedById?: string | null;
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

const formId = "journal-entry-form";

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

const JournalEntryForm = ({
  journalEntryId,
  displayId,
  status,
  sourceType,
  sourceDocument,
  reversedById,
  initialValues,
  initialLines,
  companies,
  dimensions,
  lineDimensions,
  isDisabled = false
}: JournalEntryFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const deleteModal = useDisclosure();
  const reverseModal = useDisclosure();
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
  const isDraft = status === "Draft";
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
  const isBalanced = Math.abs(difference) < 0.01;

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

  const statusBadge = <JournalEntryStatus status={status as any} />;

  const menuItems = (
    <>
      {isPosted && permissions.can("create", "accounting") && (
        <DropdownMenuItem destructive onClick={reverseModal.onOpen}>
          <DropdownMenuIcon icon={<LuRotateCcw />} />
          <Trans>Reverse Entry</Trans>
        </DropdownMenuItem>
      )}
      {isDraft && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            disabled={
              !permissions.can("delete", "accounting") ||
              !permissions.is("employee")
            }
            destructive
            onClick={deleteModal.onOpen}
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            <Trans>Delete Journal Entry</Trans>
          </DropdownMenuItem>
        </>
      )}
    </>
  );

  return (
    <>
      <RecordHeroTarget bleed />
      <Card className="max-md:mt-4">
        <ValidatedForm
          id={formId}
          method="post"
          validator={journalEntryValidator}
          defaultValues={initialValues}
          isReadOnly={isDisabled}
          style={{ width: "100%" }}
        >
          <DocumentHeader
            title={displayId}
            status={statusBadge}
            menuItems={isDraft || isPosted ? menuItems : undefined}
            actions={
              <>
                {sourceDocument && (
                  <RecordAction slot="overflow">
                    <Button
                      variant="secondary"
                      leftIcon={<LuExternalLink />}
                      asChild
                    >
                      <Link to={sourceDocument.to}>
                        {sourceDocument.readableId}
                      </Link>
                    </Button>
                  </RecordAction>
                )}
                {isReversed && reversedById && (
                  <RecordAction slot="overflow">
                    <Button variant="secondary" asChild>
                      <Link to={path.to.journalEntryDetails(reversedById)}>
                        <Trans>Reversing Entry</Trans>
                      </Link>
                    </Button>
                  </RecordAction>
                )}
                {isDraft && permissions.can("update", "accounting") && (
                  <>
                    {/* `form` keeps these submitting from the phone action
                      bar, which renders outside the <form>. */}
                    <RecordAction slot="secondary">
                      <Button
                        type="submit"
                        form={formId}
                        name="intent"
                        value="save"
                        leftIcon={<LuSave />}
                        variant="secondary"
                      >
                        <Trans>Save Draft</Trans>
                      </Button>
                    </RecordAction>
                    <RecordAction slot="primary">
                      <Button
                        type="submit"
                        form={formId}
                        name="intent"
                        value="post"
                        leftIcon={<LuCheckCheck />}
                        variant="primary"
                        isDisabled={!isBalanced || totalDebits === 0}
                      >
                        <Trans>Post</Trans>
                      </Button>
                    </RecordAction>
                  </>
                )}
              </>
            }
          />

          <CardContent>
            <Hidden name="id" />
            <input type="hidden" name="lines" value={linesJson} />
            <VStack spacing={4} className="w-full">
              {/* Entry Details */}
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 w-full">
                <div className="col-span-3 max-md:col-span-1">
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
              <div className="rounded-lg border border-border overflow-hidden w-full">
                {/* Column Headers */}
                <div className="grid grid-cols-[auto_1fr_140px_140px_40px] items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border max-md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_40px]">
                  <div className="w-6" />
                  <div className="pl-3 max-md:col-span-3">
                    <Trans>Account & Details</Trans>
                  </div>
                  <div className="text-right pr-3 max-md:col-start-2">
                    <LabelWithHelp
                      variant="inline"
                      termId="journal-line-debit"
                      className="justify-end"
                    >
                      <Trans>Debit</Trans>
                    </LabelWithHelp>
                  </div>
                  <div className="text-right pr-3">
                    <LabelWithHelp
                      variant="inline"
                      termId="journal-line-credit"
                      className="justify-end"
                    >
                      <Trans>Credit</Trans>
                    </LabelWithHelp>
                  </div>
                  <div />
                </div>

                {/* Lines */}
                <div className="divide-y divide-border">
                  {lines.map((line, index) => (
                    <JournalLineRow
                      key={line.id}
                      line={line}
                      index={index}
                      currencyCode={company.baseCurrencyCode}
                      onChange={(updatedLine) =>
                        handleLineChange(index, updatedLine)
                      }
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
                    Add Line
                  </button>
                )}

                {/* Totals */}
                <div className="grid grid-cols-[auto_1fr_140px_140px_40px] items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border max-md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_40px]">
                  <div className="w-6" />
                  <div className="flex items-center gap-2 text-sm font-medium max-md:col-span-3 max-md:flex-wrap">
                    Totals
                    {isBalanced && totalDebits > 0 ? (
                      <Status color="green">Balanced</Status>
                    ) : totalDebits === 0 && totalCredits === 0 ? (
                      <Status color="yellow">
                        Enter at least one debit and credit
                      </Status>
                    ) : (
                      <Status color="yellow">
                        Unbalanced
                        {totalDebits > 0 && (
                          <span className="ml-1 font-normal">
                            ({currencyFormatter.format(Math.abs(difference))}{" "}
                            {difference > 0 ? "more debits" : "more credits"})
                          </span>
                        )}
                      </Status>
                    )}
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums max-md:col-start-2">
                    {currencyFormatter.format(totalDebits)}
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    {currencyFormatter.format(totalCredits)}
                  </div>
                  <div />
                </div>
              </div>
            </VStack>
          </CardContent>
        </ValidatedForm>
      </Card>

      <ConfirmDelete
        isOpen={deleteModal.isOpen}
        name={displayId}
        text="Are you sure you want to delete this journal entry?"
        onCancel={deleteModal.onClose}
        onSubmit={() => {
          deleteModal.onClose();
          navigate(path.to.deleteJournalEntry(journalEntryId));
        }}
      />
      <ConfirmDelete
        action={path.to.reverseJournalEntry(journalEntryId)}
        isOpen={reverseModal.isOpen}
        name={displayId}
        deleteText="Reverse Entry"
        text="Are you sure you want to reverse this journal entry? This will create a new posted entry with negated amounts and mark this entry as Reversed."
        onCancel={reverseModal.onClose}
        onSubmit={reverseModal.onClose}
      />
    </>
  );
};

export default JournalEntryForm;
