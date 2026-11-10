// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";

// The limits a Measurement step's value must fall within. Both limits are
// inclusive: a value equal to either one passes.
export function MeasurementLimits({
  minValue,
  maxValue,
  unit
}: {
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string;
}) {
  const { t } = useLingui();
  const unitLabel = unit ?? "";
  if (minValue != null && maxValue != null) {
    return t`Must be between ${minValue} and ${maxValue} ${unitLabel}`;
  }
  if (minValue != null) return t`Must be at least ${minValue} ${unitLabel}`;
  if (maxValue != null) return t`Must be at most ${maxValue} ${unitLabel}`;
  return null;
}
