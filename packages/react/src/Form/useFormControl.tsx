// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AriaAttributes } from "react";
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
