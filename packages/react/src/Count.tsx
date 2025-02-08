import type { ComponentProps } from "react";
import { Badge } from "./Badge";
export interface CountProps extends ComponentProps<typeof Badge> {
  count: number;
}

const Count = ({ count, ...props }: CountProps) => {
  const c = count > 99 ? "99+" : count;
  return <Badge variant="gray" {...props}>{`${c}`}</Badge>;
};

export { Count };
