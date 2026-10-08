// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { Link } from "react-router";
import { cn } from "./utils/cn";

const tabBarItemClassName =
  "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium leading-none outline-none transition-transform active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The phone bottom tab bar. Hidden at md and up. */
export function TabBar({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        "md:hidden flex shrink-0 items-stretch border-t border-border bg-card/92 px-1 pt-1 pb-safe backdrop-blur",
        className
      )}
      {...props}
    >
      {children}
    </nav>
  );
}

type TabBarItemProps = {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  /** A count on the icon. Hidden when 0 or missing. */
  count?: number;
  /** A pill behind the icon of the active tab. */
  pill?: boolean;
} & (
  | { to: string; onClick?: never }
  // A button; it can be a Radix trigger (`asChild`) for a menu or sheet.
  | ({ to?: never } & Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "children" | "className"
    >)
);

/** One tab: a link when `to` is set, else a button. */
export const TabBarItem = forwardRef<HTMLButtonElement, TabBarItemProps>(
  (props, ref) => {
    const { icon, label, isActive = false, count, pill = false } = props;
    const content = (
      <>
        <span
          className={cn(
            "relative flex items-center justify-center [&>svg]:size-5",
            pill ? "h-7 w-12 rounded-full" : "size-6",
            pill && isActive && "bg-active",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {icon}
          {count ? (
            <span className="absolute -top-1 left-1/2 ml-1 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "max-w-full truncate",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      </>
    );

    if (props.to !== undefined) {
      return (
        <Link
          to={props.to}
          className={tabBarItemClassName}
          aria-current={isActive ? "page" : undefined}
        >
          {content}
        </Link>
      );
    }

    const {
      icon: _icon,
      label: _label,
      isActive: _isActive,
      count: _count,
      pill: _pill,
      to: _to,
      ...buttonProps
    } = props;
    return (
      <button
        ref={ref}
        type="button"
        {...buttonProps}
        className={tabBarItemClassName}
      >
        {content}
      </button>
    );
  }
);
TabBarItem.displayName = "TabBarItem";
