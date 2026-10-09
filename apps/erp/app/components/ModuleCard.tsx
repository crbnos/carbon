// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { PrefetchLink } from "@carbon/react";
import { Link } from "react-router";
import type { Authenticated, NavItem } from "~/types";

/** A module tile: Home's module grid and the compact Modules sheet. */
export const ModuleCard = ({ module }: { module: Authenticated<NavItem> }) => {
  const Anchor = module.external ? Link : PrefetchLink;
  return (
    <Anchor
      to={module.to}
      {...(module.external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className="flex items-center gap-4 p-4 rounded-lg border border-border group bg-muted/20 hover:border-foreground/20 cursor-pointer transition-colors duration-200 max-md:min-h-[88px] max-md:min-w-0 max-md:flex-col max-md:justify-center max-md:gap-2 max-md:p-3 max-md:bg-card"
    >
      <div className="shrink-0 p-2.5 rounded-lg border border-border group-hover:border-foreground/20 transition-colors max-md:p-2">
        <module.icon className="text-xl" />
      </div>
      <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-background font-medium tracking-tight transition-colors max-md:max-w-full max-md:truncate max-md:border-0 max-md:p-0 max-md:text-[13px]">
        {module.name}
      </span>
    </Anchor>
  );
};
