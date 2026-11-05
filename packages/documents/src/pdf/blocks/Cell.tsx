// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { ComponentProps, ReactNode } from "react";

type Style = NonNullable<ComponentProps<typeof View>["style"]>;

const withWidth = (style: Style | undefined, width: string) => [
  ...(Array.isArray(style) ? style : style ? [style] : []),
  { width }
];

/** A table cell. A hidden column has no width, so the cell prints nothing. */
export function Cell({
  width,
  style,
  children
}: {
  width: string | undefined;
  style?: Style;
  children?: ReactNode;
}) {
  if (!width) return null;
  return <View style={withWidth(style, width)}>{children}</View>;
}

export function TextCell({
  width,
  style,
  children
}: {
  width: string | undefined;
  style?: Style;
  children?: ReactNode;
}) {
  if (!width) return null;
  return <Text style={withWidth(style, width)}>{children}</Text>;
}
