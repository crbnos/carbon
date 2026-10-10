// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
  ReactNode
} from "react";
import { forwardRef } from "react";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";

import { ClientOnly } from "./ClientOnly";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator
} from "./Command";
import { DialogRoot } from "./Modal";
import { cn } from "./utils/cn";
import { usePhoneOpenAutoFocus } from "./Viewport";

/**
 * The phone's floating navigation pill and the menu it opens. The pill sits
 * centred in a borderless band at the bottom of the screen; the menu rises
 * above it as an inset card and draws the pill again over its overlay, so the
 * pill stays lit and its menu button turns into the close button. Hidden at
 * md and up.
 */
const dockPositionClassName =
  "flex shrink-0 justify-center px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]";

/** The pill itself. `Dock` places it; `DockMenuContent` redraws it. */
function DockBar({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        "flex h-12 items-center gap-0.5 rounded-full border border-border bg-popover/95 p-1 shadow-lg backdrop-blur",
        className
      )}
      {...props}
    >
      {children}
    </nav>
  );
}

/**
 * The pill in the shell's bottom band, in flow so pages end above it.
 * `className` styles the band (e.g. `hidden`); the rest go to the pill.
 */
function Dock({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <div className={cn("md:hidden", dockPositionClassName, className)}>
      <DockBar {...props} />
    </div>
  );
}

type DockItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  /** A visible label beside the icon; icon-only items need `aria-label`. */
  label?: ReactNode;
};

/** One control in the pill: an icon, with a label for the widest item. */
const DockItem = forwardRef<HTMLButtonElement, DockItemProps>(
  ({ icon, label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-10 shrink-0 items-center justify-center gap-2 rounded-full text-[15px] text-muted-foreground outline-none transition-colors active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-5",
        label ? "pl-3 pr-4" : "w-11",
        className
      )}
      {...props}
    >
      {icon}
      {label ? <span className="truncate">{label}</span> : null}
    </button>
  )
);
DockItem.displayName = "DockItem";

/** The hairline between groups of pill controls. */
function DockSeparator() {
  return <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />;
}

/** Opens and closes the dock menu; controlled by the shell. */
const DockMenu = DialogRoot;

type DockMenuContentProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** Names the menu for screen readers. */
  label: string;
  /** The pill, drawn over the overlay in the same place as the shell's. */
  dock: ReactNode;
  /**
   * A `DockFinder` that takes the whole screen in place of the menu while a
   * switcher's ⇕ is open. Escape should close it, not the menu
   * (`onEscapeKeyDown`).
   */
  finder?: ReactNode;
};

/**
 * The menu above the pill. Children stack bottom-up against the pill —
 * typically a row of switchers over a `DockMenuPanel`. A tap on the dimmed
 * space around them closes the menu.
 */
const DockMenuContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DockMenuContentProps
>(({ className, children, label, dock, finder, ...props }, ref) => {
  const onOpenAutoFocus = usePhoneOpenAutoFocus(props.onOpenAutoFocus);
  return (
    <ClientOnly fallback={null}>
      {() => (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          {/* The content spans the screen's width, but only its parts take
              touches: a tap in the gaps between them lands on the overlay,
              which closes the menu like any tap outside. */}
          <DialogPrimitive.Content
            ref={ref}
            aria-describedby={undefined}
            className={cn(
              "group pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex max-h-[100dvh] flex-col pt-[calc(env(safe-area-inset-top)+2.5rem)] outline-none md:hidden",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
              className
            )}
            {...props}
            onOpenAutoFocus={onOpenAutoFocus}
          >
            <DialogPrimitive.Title className="sr-only">
              {label}
            </DialogPrimitive.Title>
            {finder ?? (
              <>
                <div className="flex min-h-0 flex-col gap-2 px-3 [&>*]:pointer-events-auto group-data-[state=open]:animate-in group-data-[state=open]:fade-in-0 group-data-[state=open]:slide-in-from-bottom-4 group-data-[state=open]:duration-300 group-data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]">
                  {children}
                </div>
                <div
                  className={cn(
                    dockPositionClassName,
                    "[&>*]:pointer-events-auto"
                  )}
                >
                  {dock}
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </ClientOnly>
  );
});
DockMenuContent.displayName = "DockMenuContent";

/** The menu's card: one scrolling surface of rows and sections. */
function DockMenuPanel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover shadow-xl",
        className
      )}
      {...props}
    />
  );
}

/** A section of the panel; every section but the first opens with a hairline. */
function DockMenuSection({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col border-t border-border p-1.5 first:border-t-0",
        className
      )}
      {...props}
    />
  );
}

/**
 * One row of the panel. The current page (`aria-current="page"`, or "true"
 * for a current choice) is lit; the rest stay muted until touched.
 */
const dockMenuRowClassName =
  "relative flex min-h-11 w-full select-none items-center gap-3 rounded-lg px-3 text-left text-[15px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground active:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-foreground aria-[current=true]:bg-accent aria-[current=true]:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

/**
 * A switcher above the panel: icon, name, and ⇕ after a hairline. A tap
 * anywhere on it opens its `DockFinder`. Without `onSwitch` there is nothing
 * to switch to: it stays as a label, disabled, with no ⇕.
 */
function DockSwitcher({
  icon,
  label,
  onSwitch,
  switchLabel,
  className
}: {
  icon: ReactNode;
  label: ReactNode;
  onSwitch?: () => void;
  /** Names the button, e.g. "Switch company". */
  switchLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={switchLabel}
      aria-haspopup="listbox"
      disabled={!onSwitch}
      onClick={onSwitch}
      className={cn(
        "flex h-10 min-w-0 shrink items-center gap-2 rounded-full border border-border bg-popover pl-2 text-[15px] font-medium text-foreground shadow-lg outline-none transition-colors active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-100",
        onSwitch ? "pr-3" : "pr-3.5",
        className
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center [&_svg]:size-[18px]">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {onSwitch ? (
        <>
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
          <LuChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </>
      ) : null}
    </button>
  );
}

/**
 * A switcher's finder: the whole screen, a search field with Esc over a flat
 * list of `DockFinderItem`s. Typing filters the list; Esc returns to the menu.
 */
function DockFinder({
  placeholder,
  closeLabel,
  emptyLabel,
  onClose,
  children
}: {
  placeholder: string;
  /** Names the Esc button for screen readers. */
  closeLabel: string;
  /** Shown when nothing matches the search. */
  emptyLabel: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Command
      loop
      className="pointer-events-auto fixed inset-0 rounded-none bg-background pt-safe animate-in fade-in-0 duration-150"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-4">
        <CommandPrimitive.Input
          autoFocus
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="flex h-7 shrink-0 items-center rounded-md border border-border px-2 text-xs font-medium text-muted-foreground outline-none active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Esc
        </button>
      </div>
      <CommandList className="max-h-none flex-1 overscroll-contain p-1.5 pb-safe">
        <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </CommandEmpty>
        {children}
      </CommandList>
    </Command>
  );
}

/** A titled run of finder rows; the title shows only when given. */
function DockFinderGroup({
  heading,
  children
}: {
  heading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CommandGroup heading={heading} className="p-0">
      {children}
    </CommandGroup>
  );
}

/** The hairline before a finder's actions (Add Company). */
function DockFinderSeparator() {
  return <CommandSeparator className="mx-0 my-1.5" />;
}

/**
 * One finder row: icon, name, an optional badge, and ✓ on the current one.
 * `value` is what the search matches.
 */
function DockFinderItem({
  value,
  icon,
  label,
  badge,
  isCurrent = false,
  onSelect
}: {
  value: string;
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  isCurrent?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      aria-current={isCurrent ? "true" : undefined}
      className="min-h-11 gap-3 rounded-lg px-3 py-0 text-[15px] text-foreground aria-selected:bg-accent"
    >
      {icon ? (
        <span className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      <span className="flex-1" />
      {isCurrent ? <LuCheck className="size-5 shrink-0" /> : null}
    </CommandItem>
  );
}

export {
  Dock,
  DockBar,
  DockFinder,
  DockFinderGroup,
  DockFinderItem,
  DockFinderSeparator,
  DockItem,
  DockMenu,
  DockMenuContent,
  DockMenuPanel,
  DockMenuSection,
  DockSeparator,
  DockSwitcher,
  dockMenuRowClassName
};
