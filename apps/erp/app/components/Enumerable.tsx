import type { Color } from "@carbon/utils";
import { getColor, getColorByValue } from "@carbon/utils";

import type { BadgeProps } from "@carbon/react";
import { Badge } from "@carbon/react";
import { useMode } from "@carbon/remix";

type EnumerableProps = BadgeProps & {
  value: string | null;
  color?: Color;
};

const Enumerable = ({ value, color, ...props }: EnumerableProps) => {
  const mode = useMode();
  if (!value) return null;

  const style = color ? getColor(color, mode) : getColorByValue(value, mode);
  return (
    <Badge style={style} {...props}>
      {value}
    </Badge>
  );
};

export { Enumerable };
