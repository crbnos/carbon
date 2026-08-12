import { Button, cn, IconButton, Input } from "@carbon/react";
import type { PairEntry, ValueOrRef } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { LuPlus, LuX } from "react-icons/lu";
import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import {
  addRow,
  entriesOf,
  removeRow,
  setRowName,
  setRowValue,
  toValue
} from "./pairsRows";
import type { ValueFieldProps } from "./types";

/** Named rows — request headers today. The name is plain text: a header name takes
 * no variables, so it gets no menu. */
export function PairsField({
  label,
  required,
  helpTermId,
  value,
  onChange,
  context,
  issue,
  partIssues
}: ValueFieldProps) {
  const { t } = useLingui();
  const entries = entriesOf(value);

  const emit = useCallback(
    (next: PairEntry[]) => onChange(toValue(next)),
    [onChange]
  );

  const handleAdd = useCallback(() => emit(addRow(entries)), [emit, entries]);
  const handleRemove = useCallback(
    (index: number) => emit(removeRow(entries, index)),
    [emit, entries]
  );
  const handleName = useCallback(
    (index: number, name: string) => emit(setRowName(entries, index, name)),
    [emit, entries]
  );
  const handleValue = useCallback(
    (index: number, next: ValueOrRef | undefined) =>
      emit(setRowValue(entries, index, next)),
    [emit, entries]
  );

  return (
    <Field
      label={label}
      required={required}
      helpTermId={helpTermId}
      issue={issue}
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        {entries.map((entry, index) => {
          const rowIssue = partIssues?.[index];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
            <div key={index} className="flex w-full min-w-0 flex-col gap-1">
              <div className="flex w-full min-w-0 items-start gap-1">
                <Input
                  className={cn(
                    "w-[38%] shrink-0",
                    rowIssue && "border-destructive"
                  )}
                  placeholder={t`Name`}
                  value={entry.name}
                  onChange={(e) => handleName(index, e.target.value)}
                />
                <InlineValueEditor
                  textOnly
                  collapseSingleRef={false}
                  value={entry.value}
                  onChange={(next) => handleValue(index, next)}
                  context={context}
                  placeholder={t`Value`}
                  hasIssue={!!rowIssue}
                />
                <IconButton
                  icon={<LuX />}
                  aria-label={t`Remove row`}
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleRemove(index)}
                />
              </div>
              {rowIssue && (
                <p className="text-xs text-destructive">{rowIssue}</p>
              )}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<LuPlus />}
            onClick={handleAdd}
          >
            <Trans>Add header</Trans>
          </Button>
        </div>
      </div>
    </Field>
  );
}
