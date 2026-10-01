// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BadgeProps } from "@carbon/react";
import { Badge, useMode } from "@carbon/react";
import type { Color } from "@carbon/utils";
import { getColor, getColorByValue } from "@carbon/utils";

type EnumerableProps = BadgeProps & {
  value: string | null;
  color?: Color;
};

const Enumerable = ({ value, color, ...props }: EnumerableProps) => {
  const mode = useMode();
  if (!value) return null;

  const style = color ? getColor(color, mode) : getColorByValue(value, mode);
  return (
    <Badge style={{ ...style, borderColor: `${style.color}33` }} {...props}>
      {value}
    </Badge>
  );
};

export { Enumerable };
export default Enumerable;
