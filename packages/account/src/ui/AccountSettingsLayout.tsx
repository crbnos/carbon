// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ReactNode } from "react";

/**
 * The flat layout of an account settings pane: a heading, then sections split
 * by hairlines. No cards — the modal is already the container.
 */
export function AccountSettingsPane({
  title,
  description,
  children
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-6 pb-6">
      {/* Right padding keeps the heading clear of the modal's close button. */}
      <div className="flex flex-col gap-1 pr-10">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function AccountSettingsSection({
  title,
  description,
  action,
  className,
  children
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 border-t border-border pt-6",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:items-stretch">
          <div className="flex min-w-0 flex-col gap-1">
            {title && <h3 className="text-sm font-medium">{title}</h3>}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
