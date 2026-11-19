// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { AriaAttributes } from "react";
import { useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";
import { ariaAttr } from "../utils/dom";
import { useOptionalFormControlContext } from "./FormControl";

export interface UseFormControlProps {
  isInvalid?: boolean;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  "aria-required"?: AriaAttributes["aria-required"];
  "aria-describedby"?: string;
}

/**
 * What a control inside a FormControl shows and announces: whether it is
 * invalid or required, and the error message and helper text that describe
 * it. The caller's own values win; outside a FormControl only they apply.
 *
 * It sets `aria-required`, never the native `required` attribute, so the
 * browser's own validation never runs ahead of the form's.
 */
export function useFormControl(props: UseFormControlProps) {
  const field = useOptionalFormControlContext();
  const isInvalid = props.isInvalid ?? field?.isInvalid ?? false;

  const describedBy = props["aria-describedby"]
    ? [props["aria-describedby"]]
    : [];
  // The error message is described first, and only while the control shows
  // as invalid: a caller's own isInvalid={false} wins over the FormControl.
  if (isInvalid && field?.hasFeedbackText) {
    describedBy.push(field.feedbackId);
  }
  if (field?.hasHelpText) {
    describedBy.push(field.helpTextId);
  }
  if (field?.hasDefinition) {
    describedBy.push(field.definitionId);
  }

  // Only the attributes that are set: an explicit `undefined` would replace a
  // value the control sets itself (Radix Select sets `aria-required`).
  const ariaProps: Pick<
    AriaAttributes,
    "aria-invalid" | "aria-required" | "aria-describedby"
  > = {};
  const invalid = props["aria-invalid"] ?? ariaAttr(isInvalid);
  if (invalid !== undefined) ariaProps["aria-invalid"] = invalid;
  const required = props["aria-required"] ?? ariaAttr(field?.isRequired);
  if (required !== undefined) ariaProps["aria-required"] = required;
  if (describedBy.length) ariaProps["aria-describedby"] = describedBy.join(" ");

  return { isInvalid, ariaProps };
}

/**
 * `aria-labelledby` for a control that is not a labelable element, such as a
 * select or combobox trigger: the FormControl's label, unless the caller
 * already named the control.
 */
export function useFormControlLabelledBy(props: {
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const field = useOptionalFormControlContext();
  if (props["aria-labelledby"] || props["aria-label"]) {
    return props["aria-labelledby"];
  }
  return field?.renderedLabelId;
}

/**
 * A combobox takes no name from its content, so a select or combobox trigger
 * outside a FormControl (a table filter, a toolbar picker) would have none.
 * When it has no label of its own this returns its shown text — the current
 * value or the placeholder — to use as its `aria-label`, kept in sync as the
 * text changes. Attach `ref` to the trigger.
 */
export function useContentLabel<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [label, setLabel] = useState<string>();
  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!enabled || !node) {
      setLabel(undefined);
      return;
    }
    const sync = () =>
      setLabel(node.textContent?.replace(/\s+/g, " ").trim() || undefined);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      characterData: true,
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, label: enabled ? label : undefined };
}

/**
 * The name of an inline field's icon-only trigger: "Edit Customer" or
 * "Add Customer", after the FormControl's label. Pass `label` when the
 * field renders its own label outside a FormControl.
 */
export function useInlineTriggerLabel(hasValue: boolean, label?: string) {
  const { t } = useLingui();
  const field = useOptionalFormControlContext();
  const fieldLabel = label || field?.labelText;
  if (hasValue) return fieldLabel ? t`Edit ${fieldLabel}` : t`Edit`;
  return fieldLabel ? t`Add ${fieldLabel}` : t`Add`;
}

/**
 * The name of a picker's popup and of the search box inside it: the caller's
 * `aria-label`, else the FormControl's label. Undefined outside both.
 */
export function usePickerLabel(ariaLabel?: string) {
  const field = useOptionalFormControlContext();
  return ariaLabel || field?.labelText || undefined;
}

/**
 * The name of a field's clear button: "Clear Customer" after the caller's
 * `aria-label` or the FormControl's label, so a form's several clear buttons
 * are told apart. Plain "Clear" outside both.
 */
export function useClearLabel(ariaLabel?: string) {
  const { t } = useLingui();
  const fieldLabel = usePickerLabel(ariaLabel);
  return fieldLabel ? t`Clear ${fieldLabel}` : t`Clear`;
}
