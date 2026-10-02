// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { Text, View } from "react-native";

/**
 * A quantity with its context, never a bare number.
 *
 * "12 of 40" is a fact an operator can act on; "12" needs them to remember
 * what the job was for. The design rules require the context, so the suffix is
 * part of the component rather than something a caller may forget.
 *
 * Formatting goes through `formatQuantity` — the quantity kind from
 * `.claude/rules/numeric-precision.md`, max 5 decimals, no padding — so a
 * fractional pick quantity is not silently rounded to "0".
 */
export function BigNumber({
  value,
  of,
  suffix,
  className
}: {
  value: number;
  /** Renders as "of N". Pass `suffix` instead for any other context. */
  of?: number | null;
  suffix?: string;
  className?: string;
}) {
  const { i18n } = useLingui();
  const locale = i18n.locale || "en";
  const context =
    suffix ??
    (of === null || of === undefined
      ? undefined
      : `of ${formatQuantity(of, locale)}`);

  return (
    <View className={`flex-row items-baseline gap-2 ${className ?? ""}`}>
      <Text className="text-4xl font-semibold text-foreground">
        {formatQuantity(value, locale)}
      </Text>
      {context ? (
        <Text className="text-base text-muted-foreground">{context}</Text>
      ) : null}
    </View>
  );
}
