// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { Trans } from "@lingui/react/macro";
import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import type { LinkProps } from "react-router";
import { Link, useLocation } from "react-router";
import { Drawer, DrawerContent, DrawerTitle } from "./Drawer";
import { Separator } from "./Separator";
import { useSidebar } from "./Sidebar";
import { cn } from "./utils/cn";
import { VStack } from "./VStack";

const focusRingClasses = [
  "focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0",
  "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-lg after:border after:border-blue-500 after:opacity-0 after:ring-2 after:ring-blue-500/20 after:transition-opacity focus-visible:after:opacity-100 active:after:opacity-0"
];

export const navRailItemClasses = [
  "relative text-foreground/70 hover:text-foreground",
  "h-10 w-10 group-data-[state=expanded]:w-full",
  "flex items-center rounded-md",
  "group-data-[state=collapsed]:justify-center",
  "group-data-[state=expanded]:-space-x-2",
  "font-medium shrink-0 inline-flex items-center justify-center select-none",
  "disabled:opacity-50",
  "transition-[background-color,color,width] duration-100 ease-out",
  focusRingClasses,
  "group/item"
];

/**
 * The primary left navigation shared by the ERP and MES app shells: a 56px
 * icon rail that grows to 208px while a mouse hovers it or while it is pinned
 * open (a `SidebarTrigger`, or ⌘B where the provider binds it), and a left drawer below `md`. Open state
 * comes from `SidebarProvider`, so it must be rendered inside one.
 */
// A pointer only passing over the rail (on its way to the page) shouldn't open it.
const HOVER_OPEN_DELAY_MS = 150;

// Lets an item freeze the rail as it is (open or collapsed) while a menu or
// popover it triggered is open, so a tap on a collapsed rail never opens it.
const NavRailHoldContext = createContext<(() => () => void) | null>(null);

export function NavRail({
  children,
  header,
  footer,
  forceExpanded = false,
  disableHover = false
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  /** Hold the rail open regardless of hover or pin (e.g. while rearranging). */
  forceExpanded?: boolean;
  /** Ignore hover, e.g. while a modal owns the pointer. */
  disableHover?: boolean;
}) {
  const { open, isMobile, openMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const [hovered, setHovered] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const lastPointerType = useRef<string>();
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelHoverOpen = useCallback(() => {
    clearTimeout(openTimer.current);
    openTimer.current = undefined;
  }, []);
  useEffect(() => cancelHoverOpen, [cancelHoverOpen]);
  const [holds, setHolds] = useState(0);
  const hold = useCallback(() => {
    setHolds((n) => n + 1);
    return () => setHolds((n) => n - 1);
  }, []);

  // Links, go-to shortcuts and redirects all land here: whatever navigated,
  // the phone drawer must not stay over the destination.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per navigation
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  // A Radix dialog or menu sets pointer-events: none on document.body while
  // open, which fires a leave on the rail as it opens and a phantom enter as
  // it closes, so pointer events are ignored while blocked. A modal (search)
  // collapses the rail; a menu opened from the rail keeps it as it was. When
  // the block lifts, hover is re-read from where the pointer really is.
  const hoverBlocked = disableHover || holds > 0;
  useEffect(() => {
    if (disableHover) setHovered(false);
  }, [disableHover]);
  useEffect(() => {
    cancelHoverOpen();
    if (hoverBlocked) return;
    // Touch browsers leave `:hover` stuck on the last tapped element, so only
    // a mouse's `:hover` counts.
    const raf = requestAnimationFrame(() =>
      setHovered(
        lastPointerType.current === "mouse" &&
          (navRef.current?.matches(":hover") ?? false)
      )
    );
    return () => cancelAnimationFrame(raf);
  }, [hoverBlocked, cancelHoverOpen]);

  const content = (
    <NavRailHoldContext.Provider value={hold}>
      <VStack spacing={1} className="flex flex-col justify-between h-full px-2">
        <VStack spacing={1}>
          {header ? <div className="w-full pb-2">{header}</div> : null}
          {children}
        </VStack>
        {footer ? <VStack spacing={1}>{footer}</VStack> : null}
      </VStack>
    </NavRailHoldContext.Provider>
  );

  if (isMobile) {
    return (
      <Drawer open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent
          position="left"
          size="content"
          className="w-[17rem] max-w-[85vw] p-0"
        >
          <DrawerTitle className="px-6 py-4">
            <Trans>Navigation</Trans>
          </DrawerTitle>
          <nav
            data-state="expanded"
            className="group flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent pb-4"
          >
            {content}
          </nav>
        </DrawerContent>
      </Drawer>
    );
  }

  const state = forceExpanded || open || hovered ? "expanded" : "collapsed";

  return (
    // The wrapper (not just the inner nav) grows on expand, so the rail pushes
    // the rest of the layout right instead of floating over it. Sticky so it
    // stays in view in shells whose page scrolls as a whole.
    <div
      data-state={state}
      className={cn(
        "sticky top-0 h-svh flex-col z-50 hidden md:flex shrink-0",
        "w-14 data-[state=expanded]:w-[13rem]",
        "transition-[width] duration-200"
      )}
    >
      <nav
        ref={navRef}
        data-state={state}
        className={cn(
          "bg-background py-2 group z-10 h-full w-full",
          "flex flex-col justify-between",
          "hide-scrollbar overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        )}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
        }}
        // Mouse only: a tap on a touch tablet must not expand the rail.
        onPointerMove={(event) => {
          lastPointerType.current = event.pointerType;
          if (hoverBlocked || hovered || openTimer.current) return;
          if (event.pointerType !== "mouse") return;
          openTimer.current = setTimeout(() => {
            openTimer.current = undefined;
            setHovered(true);
          }, HOVER_OPEN_DELAY_MS);
        }}
        // A mouse event, not `onPointerLeave`: Chrome can lose its pointer
        // boundary tracking for an element and then never send a pointer
        // leave for it (it re-sends `pointerenter` on every move instead)
        // while mouse leave events keep arriving. The rail stayed expanded
        // until a reload. `hovered` is only ever set by a mouse, so there is
        // no pointer type to check here.
        onMouseLeave={() => {
          if (hoverBlocked) return;
          // The leave a Radix layer causes by disabling body pointer-events
          // can arrive before this render knows about the hold.
          if (document.body.style.pointerEvents === "none") return;
          cancelHoverOpen();
          setHovered(false);
        }}
      >
        {content}
      </nav>
    </div>
  );
}

type NavRailItemProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  icon: ReactNode;
  /** Also the accessible name; the visible label span is aria-hidden. */
  label: string;
  isActive?: boolean;
  tag?: ReactNode;
  /** Shown at the right edge only while expanded (e.g. a shortcut hint). */
  trailing?: ReactNode;
  asChild?: boolean;
  children?: ReactNode;
};

/**
 * One rail entry. A `<button>` by default; with `asChild` the child element
 * becomes the item, so a `Link` or a Radix trigger keeps its own semantics.
 */
export const NavRailItem = forwardRef<HTMLButtonElement, NavRailItemProps>(
  (
    {
      icon,
      label,
      isActive = false,
      tag,
      trailing,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    // Radix triggers (menus, popovers) pass their open state as `data-state`.
    const isTriggerOpen =
      (props as Record<string, unknown>)["data-state"] === "open";
    const hold = useContext(NavRailHoldContext);
    useEffect(() => {
      if (isTriggerOpen && hold) return hold();
    }, [isTriggerOpen, hold]);

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-label={label}
        {...props}
        className={cn(
          navRailItemClasses,
          isActive
            ? "bg-active text-active-foreground dark:shadow-button-base"
            : "hover:bg-active/60 hover:text-active-foreground",
          className
        )}
      >
        {/* A 16px icon centred in this 24px box sits where a `left-3 top-3`
            icon would; the box also fits an `Avatar size="xs"`. */}
        <span className="absolute left-2 top-2 flex size-6 items-center justify-center [&>svg]:size-4">
          {icon}
        </span>
        {tag ? (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-4 text-center tabular-nums">
            {tag}
          </span>
        ) : null}
        {/* Label and trailing share one row so a long label truncates
            before the trailing content instead of running under it. */}
        <span
          className={cn(
            "absolute left-7 right-3 min-w-32 group-data-[state=expanded]:left-12",
            "flex items-center gap-2",
            "opacity-0 group-data-[state=expanded]:opacity-100"
          )}
        >
          <span
            aria-hidden
            className="min-w-0 flex-1 truncate text-sm text-left"
          >
            {label}
          </span>
          {trailing ? (
            <span className="pointer-events-none flex shrink-0 items-center">
              {trailing}
            </span>
          ) : null}
        </span>
        <Slottable>{children}</Slottable>
      </Comp>
    );
  }
);
NavRailItem.displayName = "NavRailItem";

export function NavRailLink({
  to,
  icon,
  label,
  isActive = false,
  tag,
  trailing,
  external = false,
  target,
  rel
}: {
  to: string;
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  tag?: ReactNode;
  trailing?: ReactNode;
  external?: boolean;
  target?: LinkProps["target"];
  rel?: string;
}) {
  return (
    <NavRailItem
      asChild
      icon={icon}
      label={label}
      isActive={isActive}
      tag={tag}
      trailing={trailing}
    >
      <Link
        to={to}
        target={target}
        rel={rel}
        aria-current={isActive ? "page" : undefined}
        prefetch={external ? "none" : "intent"}
      />
    </NavRailItem>
  );
}

/** For `header`: the logo sits in the icon column, the name has equal margins. */
export function NavRailBrand({
  href,
  logo,
  label
}: {
  href: string;
  logo: ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className={cn(
        "relative flex h-10 w-full items-center gap-2 rounded-md px-2",
        "text-sm font-medium text-foreground select-none",
        "transition-[background-color] duration-100 ease-out hover:bg-active/60",
        focusRingClasses
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-4">
        {logo}
      </span>
      <span
        aria-hidden
        className="min-w-0 flex-1 truncate opacity-0 transition-opacity duration-200 group-data-[state=expanded]:opacity-100"
      >
        {label}
      </span>
    </a>
  );
}

/** A titled section; collapsed, its title turns into a divider. */
export function NavRailGroup({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack spacing={1}>
      <div className="relative h-7 w-full shrink-0">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 mx-auto h-px w-6 bg-border opacity-100 transition-opacity duration-200 group-data-[state=expanded]:opacity-0"
        />
        <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium uppercase tracking-wider text-foreground/50 whitespace-nowrap opacity-0 transition-opacity duration-200 group-data-[state=expanded]:opacity-100">
          {label}
        </span>
      </div>
      {children}
    </VStack>
  );
}

export function NavRailDivider() {
  return (
    <Separator className="my-1 mx-auto w-6 group-data-[state=expanded]:w-full transition-[width] duration-200" />
  );
}
