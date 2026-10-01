// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps } from "react";
import { Badge } from "./Badge";
export interface CountProps extends ComponentProps<typeof Badge> {
  count: number;
}

const Count = ({ count, ...props }: CountProps) => {
  const c = count > 99 ? "99+" : count;
  return (
    <Badge
      variant="secondary"
      className="tabular-nums"
      {...props}
    >{`${c}`}</Badge>
  );
};

export { Count };
