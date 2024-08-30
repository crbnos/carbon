import { getColor } from "@carbon/utils";

import type { BadgeProps } from "@carbon/react";
import { Badge } from "@carbon/react";
import { useMode } from "~/hooks/useMode";

type EnumerableProps = BadgeProps & {
  value: string | null;
};

const Enumerable = ({ value, ...props }: EnumerableProps) => {
  const mode = useMode();
  if (!value) return null;
  const style = getColor(value, mode);
  return (
    <Badge style={style} {...props}>
      {value}
    </Badge>
  );
};

export { Enumerable };
