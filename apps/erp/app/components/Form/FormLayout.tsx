// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useFormContext } from "@carbon/form";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { SetupSteps } from "~/components/Setup";

/*
 * The layout pieces of a long form (carbon-design `references/forms.md`,
 * "Size and grouping"): a titled group, a folded group for fields most users
 * leave at their default, and steps for a form whose first answers decide
 * the rest. Every piece only HIDES what is not on screen: the fields stay
 * mounted, so the form still posts them, and an unmounted field would post
 * nothing and clear its column.
 */

/** One group of a form: a title, one muted line saying what the group is
 *  for, then its fields in a two-column grid. Groups after the first are
 *  separated by a hairline. A field that is not rendered leaves no hole:
 *  the grid closes up. */
export function FormGroup({
  title,
  description,
  children,
  className
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex w-full flex-col gap-4 [&+&]:border-t [&+&]:border-border [&+&]:pt-6",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

/**
 * A folded group of fields most users leave at their default. Closed, it only
 * hides its fields; it opens by itself while one of `fieldNames` has an
 * error.
 */
export function FormFold({
  title,
  defaultOpen = false,
  fieldNames,
  children
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  /** The fold opens while one of these fields has an error. */
  fieldNames?: string[];
  children: ReactNode;
}) {
  const [userOpen, setOpen] = useState(defaultOpen);
  const { fieldErrors } = useFormContext();
  const open =
    userOpen || (fieldNames ?? []).some((name) => Boolean(fieldErrors[name]));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <LuChevronRight
          className={cn(
            "size-4 shrink-0 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={cn("pt-3", !open && "hidden")}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One step of a stepped form: its label and the fields it asks for. */
export type FormStep<Id extends string = string> = {
  id: Id;
  label: string;
  fields: string[];
};

/** The steps of a form, numbered, the current one underlined: the setup
 *  wizard's step bar inside one form. */
export function FormStepBar<Id extends string>({
  steps,
  current,
  label
}: {
  steps: FormStep<Id>[];
  current: Id;
  /** The step bar's accessible name, e.g. "Add line". */
  label: string;
}) {
  const labels = Object.fromEntries(
    steps.map((step) => [step.id, step.label])
  ) as Record<Id, string>;
  return (
    <SetupSteps
      steps={steps.map((step) => step.id)}
      current={current}
      labels={labels}
      label={label}
    />
  );
}

/** A step's fields: shown only while it is the current step. The same form
 *  without steps (editing) shows every panel, one after the other. */
export function FormStepPanel({
  isCurrent,
  children,
  className
}: {
  isCurrent: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-6",
        !isCurrent && "hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The buttons of a stepped form: Back, then Next until the last step, which
 * shows `submit`. Next validates the current step's fields and stays while
 * one is invalid. A save the server refuses jumps back to the first step
 * with an error. Render it inside the `ValidatedForm`.
 */
export function FormStepButtons<Id extends string>({
  steps,
  current,
  onStepChange,
  submit,
  cancel
}: {
  steps: FormStep<Id>[];
  current: Id;
  onStepChange: (step: Id) => void;
  /** The last step's submit button. */
  submit: ReactNode;
  /** A Cancel button, rendered last. */
  cancel?: ReactNode;
}) {
  const { fieldErrors, validateField, setFieldTouched } = useFormContext();
  const index = steps.findIndex((step) => step.id === current);
  const isLast = index === steps.length - 1;

  // A refused save names fields: open the first step that holds one. Only a
  // new set of errors moves the form, not a step change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the errors alone
  useEffect(() => {
    const failing = steps.find((step) =>
      step.fields.some((name) => Boolean(fieldErrors[name]))
    );
    if (failing && failing.id !== current) onStepChange(failing.id);
  }, [fieldErrors]);

  const next = async () => {
    const fields = steps[index]!.fields;
    // Touched, a field checks itself again as it changes, so an error clears
    // once it is fixed.
    for (const name of fields) setFieldTouched(name, true);
    const errors = await Promise.all(fields.map((name) => validateField(name)));
    if (errors.some(Boolean)) return;
    onStepChange(steps[index + 1]!.id);
  };

  return (
    <>
      {index > 0 && (
        <Button
          size="md"
          variant="secondary"
          onClick={() => onStepChange(steps[index - 1]!.id)}
        >
          <Trans>Back</Trans>
        </Button>
      )}
      {isLast ? (
        submit
      ) : (
        <Button size="md" onClick={next}>
          <Trans>Next</Trans>
        </Button>
      )}
      {cancel}
    </>
  );
}
