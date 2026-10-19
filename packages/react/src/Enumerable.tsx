// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Color } from "@carbon/utils";
import { getColor, getColorByValue } from "@carbon/utils";
import { createContext, useContext } from "react";
import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";
import { useMode } from "./hooks";

type EnumerableProps = BadgeProps & {
  value: string | null;
  color?: Color;
};

/**
 * Phones: inside a compact row's context line, enumerated values read as plain
 * text instead of colour badges (the row's status pills stay badges).
 */
const EnumerableAsTextContext = createContext(false);
const EnumerableAsText = EnumerableAsTextContext.Provider;
const useEnumerableAsText = () => useContext(EnumerableAsTextContext);

const Enumerable = ({ value, color, ...props }: EnumerableProps) => {
  const mode = useMode();
  const asText = useContext(EnumerableAsTextContext);
  if (!value) return null;
  if (asText) return <span>{value}</span>;

  const style = color ? getColor(color, mode) : getColorByValue(value, mode);
  return (
    <Badge
      style={style && { ...style, borderColor: `${style.color}33` }}
      {...props}
    >
      {value}
    </Badge>
  );
};

export { Enumerable, EnumerableAsText, useEnumerableAsText };
