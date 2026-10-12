// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { ValidatedForm } from "@carbon/form";
import { LabelWithHelp, VStack } from "@carbon/react";
import type { ReactNode } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Boolean,
  Combobox,
  DatePicker,
  InputControlled,
  NumberControlled,
  Select
} from "~/components/Form";
import type { ElementUpdateField } from "../Elements/ElementProperties";
import { useElementField } from "../Elements/ElementProperties";

/*
 * The element's properties, in the inline pattern of the app's properties
 * panels (`IssueProperties`, `JobProperties`, `SalesOrderProperties`): a
 * muted label above the value, the form field's `inline` editor, one small
 * `ValidatedForm` per field, and a save on change through the element field
 * update route.
 */

/**
 * Hides the form labels' grey "Optional" tag inside a properties panel. An
 * empty property already reads as empty, so the tag only adds noise (Brad,
 * 2026-10-12: project and service screens only). Put it on the panel's root;
 * the shared `FormLabel` keeps its tag everywhere else.
 */
export const hideOptionalTags = "[&_[data-optional-tag]]:hidden";

type FieldProps = {
  projectId: string;
  elementId: string;
  field: ElementUpdateField;
  label: string;
  termId?: TermId;
  isDisabled: boolean;
};

type Option = { value: string; label: string | JSX.Element };

/** A read-only property: the muted label above the value. */
export function PropertyField({
  label,
  termId,
  children
}: {
  label: string;
  termId?: TermId;
  children: ReactNode;
}) {
  return (
    <VStack spacing={2}>
      <h3 className="text-xs text-muted-foreground">
        <LabelWithHelp termId={termId} variant="inline">
          {label}
        </LabelWithHelp>
      </h3>
      {children}
    </VStack>
  );
}

/** A group of properties under the page's plain section heading. */
export function PropertyGroup({
  title,
  termId,
  children
}: {
  title?: string;
  termId?: TermId;
  children: ReactNode;
}) {
  return (
    <VStack spacing={4}>
      {title && (
        <h2 className="text-sm font-medium">
          <LabelWithHelp termId={termId} variant="inline">
            {title}
          </LabelWithHelp>
        </h2>
      )}
      {children}
    </VStack>
  );
}

/** A choice from a short list: the form `Select` with an inline preview. */
export function PropertySelect({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  options,
  renderValue,
  isOptional = true,
  isDisabled,
  onChange
}: FieldProps & {
  value: string | null;
  options: Option[];
  renderValue?: (value: string) => JSX.Element;
  isOptional?: boolean;
  /** Runs after the save is sent (a field that drives other fields). */
  onChange?: (value: string | null) => void;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const current = pending === undefined ? value : pending;
  return (
    <ValidatedForm
      key={`${field}:${value ?? ""}`}
      defaultValues={{ [field]: value ?? "" }}
      validator={z.object({
        [field]: isOptional
          ? zfd.text(z.string().optional())
          : z.string().min(1)
      })}
      className="w-full"
    >
      <Select
        name={field}
        label={label}
        termId={termId}
        options={options}
        isOptional={isOptional}
        isReadOnly={isDisabled}
        inline={(next, opts) =>
          renderValue?.(next) ?? (
            <span>{opts.find((o) => o.value === next)?.label ?? next}</span>
          )
        }
        onChange={(option) => {
          const next = option?.value || null;
          if (next === current) return;
          submit(next);
          onChange?.(next);
        }}
      />
    </ValidatedForm>
  );
}

/** A choice from a long list: the form `Combobox` with an inline preview. */
export function PropertyCombobox({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  options,
  renderValue,
  isDisabled
}: FieldProps & {
  value: string | null;
  options: { value: string; label: string; helper?: string }[];
  renderValue?: (value: string) => ReactNode;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const current = pending === undefined ? value : pending;
  return (
    <ValidatedForm
      key={`${field}:${value ?? ""}`}
      defaultValues={{ [field]: value ?? "" }}
      validator={z.object({ [field]: zfd.text(z.string().optional()) })}
      className="w-full"
    >
      <Combobox
        name={field}
        label={label}
        termId={termId}
        options={options}
        isOptional
        isReadOnly={isDisabled}
        inline={(next, opts) =>
          renderValue?.(next) ?? (
            <span>{opts.find((o) => o.value === next)?.label ?? next}</span>
          )
        }
        onChange={(option) => {
          const next = option?.value || null;
          if (next !== current) submit(next);
        }}
      />
    </ValidatedForm>
  );
}

/** A date: the form `DatePicker` in its inline mode. */
export function PropertyDate({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  isDisabled
}: FieldProps & { value: string | null }) {
  const { submit } = useElementField(projectId, elementId, field);
  return (
    <ValidatedForm
      key={`${field}:${value ?? ""}`}
      defaultValues={{ [field]: value ?? "" }}
      validator={z.object({ [field]: zfd.text(z.string().optional()) })}
      className="w-full"
    >
      <DatePicker
        name={field}
        label={label}
        termId={termId}
        inline
        isDisabled={isDisabled}
        onChange={(date) => {
          if ((date || null) !== value) submit(date || null);
        }}
      />
    </ValidatedForm>
  );
}

/** A number: the form `NumberControlled` in its inline mode. */
export function PropertyNumber({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  formatOptions,
  step,
  minValue,
  maxValue,
  isDisabled
}: FieldProps & {
  value: number | null;
  formatOptions?: Intl.NumberFormatOptions;
  step?: number;
  minValue?: number;
  maxValue?: number;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const current =
    pending === undefined ? value : pending === null ? null : Number(pending);
  return (
    <ValidatedForm
      key={`${field}:${value ?? ""}`}
      defaultValues={{ [field]: value ?? undefined }}
      validator={z.object({
        [field]: zfd.numeric(z.number().optional())
      })}
      className="w-full"
    >
      <NumberControlled
        name={field}
        label={label}
        termId={termId}
        inline
        isReadOnly={isDisabled}
        value={current ?? Number.NaN}
        formatOptions={formatOptions}
        step={step}
        minValue={minValue}
        maxValue={maxValue}
        onChange={(next) => {
          const nextValue = Number.isNaN(next) ? null : next;
          if (nextValue !== current) {
            submit(nextValue === null ? null : String(nextValue));
          }
        }}
      />
    </ValidatedForm>
  );
}

/** Free text: the form `InputControlled` in its inline mode, saved on blur. */
export function PropertyText({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  isDisabled
}: FieldProps & { value: string | null }) {
  const { submit } = useElementField(projectId, elementId, field);
  return (
    <ValidatedForm
      key={`${field}:${value ?? ""}`}
      defaultValues={{ [field]: value ?? "" }}
      validator={z.object({ [field]: zfd.text(z.string().optional()) })}
      className="w-full"
    >
      <InputControlled
        name={field}
        label={label}
        termId={termId}
        size="sm"
        inline
        isReadOnly={isDisabled}
        value={value ?? ""}
        onBlur={(event) => {
          const next = event.target.value.trim() || null;
          if (next !== value) submit(next);
        }}
      />
    </ValidatedForm>
  );
}

/** A yes/no flag: the form `Boolean`, as the item properties panels draw it. */
export function PropertySwitch({
  projectId,
  elementId,
  field,
  label,
  termId,
  value,
  isDisabled
}: FieldProps & { value: boolean }) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const checked = pending === undefined ? value : pending === "true";
  return (
    <ValidatedForm
      key={`${field}:${value}`}
      defaultValues={{ [field]: checked }}
      validator={z.object({ [field]: zfd.checkbox() })}
      className="w-full"
    >
      <Boolean
        name={field}
        label={label}
        termId={termId}
        variant="small"
        isOptional={false}
        isDisabled={isDisabled}
        onChange={(next) => submit(next ? "true" : "false")}
      />
    </ValidatedForm>
  );
}
