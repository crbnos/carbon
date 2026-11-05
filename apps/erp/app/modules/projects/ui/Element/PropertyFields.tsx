// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { InlineLabelsProvider, ValidatedForm } from "@carbon/form";
import { LabelWithHelp, VStack } from "@carbon/react";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
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
 * update route. A `PropertySaveProvider` sends the saves elsewhere: the
 * project's properties column saves to the project.
 */

/** One property's save: the value on its way, and the send. */
export type PropertySave = {
  pending: string | null | undefined;
  submit: (value: string | null) => void;
};

type UsePropertySave = (
  projectId: string,
  elementId: string,
  field: string
) => PropertySave;

const PropertySaveContext = createContext<UsePropertySave | null>(null);

/**
 * Sends every property below to another save than the element's (a hook,
 * called once per field). The element page needs no provider.
 */
export const PropertySaveProvider = PropertySaveContext.Provider;

/**
 * `row` lays a property out as a label beside its value (a Details card);
 * `stack`, the default, puts the label above (the element page's sidebar).
 */
const PropertyLayoutContext = createContext<"stack" | "row">("stack");

/**
 * In a row, no form field draws its own label (a domain field such as
 * `Employee` or `Location` falls back to a default one): the row's label
 * column names it.
 */
export function PropertyLayoutProvider({
  value,
  children
}: {
  value: "stack" | "row";
  children: ReactNode;
}) {
  return (
    <PropertyLayoutContext.Provider value={value}>
      <InlineLabelsProvider value={value !== "row"}>
        {children}
      </InlineLabelsProvider>
    </PropertyLayoutContext.Provider>
  );
}

/** The form field's own label: none in a row, where the row shows it. */
export function usePropertyFieldLabel(label: string) {
  return useContext(PropertyLayoutContext) === "row" ? undefined : label;
}

/** In a row layout, the muted label beside the value; else the value. */
export function PropertyRow({
  label,
  termId,
  children
}: {
  label: string;
  termId?: TermId;
  children: ReactNode;
}) {
  if (useContext(PropertyLayoutContext) !== "row") return <>{children}</>;
  return (
    <div className="grid min-h-8 w-full grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
      <span className="truncate text-sm text-muted-foreground">
        <LabelWithHelp termId={termId} variant="inline">
          {label}
        </LabelWithHelp>
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The save in effect: the provider's, else the element field route. */
function usePropertySave(projectId: string, elementId: string, field: string) {
  const useSave = useContext(PropertySaveContext) ?? useElementFieldSave;
  return useSave(projectId, elementId, field);
}

function useElementFieldSave(
  projectId: string,
  elementId: string,
  field: string
): PropertySave {
  return useElementField(projectId, elementId, field as ElementUpdateField);
}

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
  /** An element field, or a project field under a project save provider. */
  field: string;
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
  const isRow = useContext(PropertyLayoutContext) === "row";
  if (isRow) {
    return (
      <PropertyRow label={label} termId={termId}>
        <div className="text-sm">{children}</div>
      </PropertyRow>
    );
  }
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
  const isRow = useContext(PropertyLayoutContext) === "row";
  return (
    <VStack spacing={isRow ? 1 : 4}>
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
  const { pending, submit } = usePropertySave(projectId, elementId, field);
  const current = pending === undefined ? value : pending;
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
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
          label={fieldLabel}
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
    </PropertyRow>
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
  const { pending, submit } = usePropertySave(projectId, elementId, field);
  const current = pending === undefined ? value : pending;
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
      <ValidatedForm
        key={`${field}:${value ?? ""}`}
        defaultValues={{ [field]: value ?? "" }}
        validator={z.object({ [field]: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <Combobox
          name={field}
          label={fieldLabel}
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
    </PropertyRow>
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
  const { submit } = usePropertySave(projectId, elementId, field);
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
      <ValidatedForm
        key={`${field}:${value ?? ""}`}
        defaultValues={{ [field]: value ?? "" }}
        validator={z.object({ [field]: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <DatePicker
          name={field}
          label={fieldLabel}
          termId={termId}
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            if ((date || null) !== value) submit(date || null);
          }}
        />
      </ValidatedForm>
    </PropertyRow>
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
  const { pending, submit } = usePropertySave(projectId, elementId, field);
  const current =
    pending === undefined ? value : pending === null ? null : Number(pending);
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
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
          label={fieldLabel}
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
    </PropertyRow>
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
  placeholder,
  isDisabled
}: FieldProps & { value: string | null; placeholder?: string }) {
  const { submit } = usePropertySave(projectId, elementId, field);
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
      <ValidatedForm
        key={`${field}:${value ?? ""}`}
        defaultValues={{ [field]: value ?? "" }}
        validator={z.object({ [field]: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <InputControlled
          name={field}
          label={fieldLabel}
          termId={termId}
          size="sm"
          inline
          isReadOnly={isDisabled}
          placeholder={placeholder}
          value={value ?? ""}
          onBlur={(event) => {
            const next = event.target.value.trim() || null;
            if (next !== value) submit(next);
          }}
        />
      </ValidatedForm>
    </PropertyRow>
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
  const { pending, submit } = usePropertySave(projectId, elementId, field);
  const checked = pending === undefined ? value : pending === "true";
  const fieldLabel = usePropertyFieldLabel(label);
  return (
    <PropertyRow label={label} termId={termId}>
      <ValidatedForm
        key={`${field}:${value}`}
        defaultValues={{ [field]: checked }}
        validator={z.object({ [field]: zfd.checkbox() })}
        className="w-full"
      >
        <Boolean
          name={field}
          label={fieldLabel}
          termId={termId}
          variant="small"
          isOptional={false}
          isDisabled={isDisabled}
          onChange={(next) => submit(next ? "true" : "false")}
        />
      </ValidatedForm>
    </PropertyRow>
  );
}
