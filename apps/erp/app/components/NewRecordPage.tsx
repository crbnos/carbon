// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { useSetAppBarOverride } from "./Layout/Mobile";
import { useBreadcrumbs } from "./Layout/Topbar/Breadcrumbs";

/**
 * Centered wrapper for a "new record" form page. On phones it is a pushed
 * screen: Back returns to the list it creates into, its last breadcrumb.
 */
export function NewRecordPage({ className, ...props }: ComponentProps<"div">) {
  const { pathname } = useLocation();
  const listTo = useBreadcrumbs().at(-1)?.to;
  const backTo = listTo && listTo !== pathname ? listTo : undefined;
  useSetAppBarOverride(
    useMemo(
      () => (backTo ? { kind: "pushed" as const, backTo } : null),
      [backTo]
    )
  );

  return (
    <div
      {...props}
      className={cn(
        "max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8 max-md:px-4 max-md:pt-3",
        className
      )}
    />
  );
}
