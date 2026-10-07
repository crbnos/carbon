// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes
} from "react";
import { forwardRef } from "react";
import { LuChevronRight, LuCircle } from "react-icons/lu";
import { RxCheck } from "react-icons/rx";
import { ActionPresentationBoundary } from "./ActionPresentation";
import {
  compactPart,
  MenuSheetCheckboxItem,
  MenuSheetContent,
  MenuSheetContextTrigger,
  MenuSheetGroup,
  MenuSheetItem,
  MenuSheetLabel,
  MenuSheetPortal,
  MenuSheetRadioGroup,
  MenuSheetRadioItem,
  MenuSheetRoot,
  MenuSheetSeparator,
  MenuSheetSub,
  MenuSheetSubContent,
  MenuSheetSubTrigger
} from "./MenuSheet";
import { ShortcutKey } from "./ShortcutKey";
import type { MenuItemShortcut } from "./shortcuts";
import { cn } from "./utils/cn";
import { withMenuShortcuts } from "./utils/menuShortcut";
import { useViewport } from "./Viewport";

const DesktopContextMenuSubTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <LuChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
));
DesktopContextMenuSubTrigger.displayName =
  ContextMenuPrimitive.SubTrigger.displayName;

const DesktopContextMenuSubContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, onKeyDown, children, ...props }, ref) => {
  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      onKeyDown={withMenuShortcuts(onKeyDown)}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.SubContent>
  );
});
DesktopContextMenuSubContent.displayName =
  ContextMenuPrimitive.SubContent.displayName;

const DesktopContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, onKeyDown, children, ...props }, ref) => {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        onKeyDown={withMenuShortcuts(onKeyDown)}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      >
        <ActionPresentationBoundary>{children}</ActionPresentationBoundary>
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
});
DesktopContextMenuContent.displayName =
  ContextMenuPrimitive.Content.displayName;

const DesktopContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    destructive?: boolean;
    /**
     * Runs this item while its menu is open — use `MENU_ITEM_SHORTCUTS`.
     * `asChild` items render exactly one child, so they get the key but no keycap.
     */
    shortcut?: MenuItemShortcut;
  }
>(
  (
    { className, inset, destructive, shortcut, asChild, children, ...props },
    ref
  ) => (
    <ContextMenuPrimitive.Item
      ref={ref}
      asChild={asChild}
      data-menu-shortcut={shortcut}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        shortcut && !asChild && "whitespace-nowrap",
        destructive &&
          "text-red-500 focus:text-red-500 hover:bg-destructive/20 active:bg-destructive/20",
        className
      )}
      {...props}
    >
      {asChild || !shortcut ? (
        children
      ) : (
        <>
          {children}
          <ContextMenuShortcut className="shrink-0 pl-4">
            <ShortcutKey shortcut={shortcut} variant="small" className="mx-0" />
          </ContextMenuShortcut>
        </>
      )}
    </ContextMenuPrimitive.Item>
  )
);
DesktopContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const DesktopContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <RxCheck className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
DesktopContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;

const DesktopContextMenuRadioItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <LuCircle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
DesktopContextMenuRadioItem.displayName =
  ContextMenuPrimitive.RadioItem.displayName;

const DesktopContextMenuLabel = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-medium text-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DesktopContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const DesktopContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
DesktopContextMenuSeparator.displayName =
  ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  );
};
ContextMenuShortcut.displayName = "ContextMenuShortcut";

/*
 * Phones render each part from MenuSheet (a bottom sheet) instead of Radix's
 * menu; see MenuSheet.tsx.
 */
const ContextMenu = (
  props: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>
) =>
  useViewport().isPhone ? (
    <MenuSheetRoot {...props} />
  ) : (
    <ContextMenuPrimitive.Root {...props} />
  );
const ContextMenuTrigger = compactPart(
  ContextMenuPrimitive.Trigger,
  MenuSheetContextTrigger,
  "ContextMenuTrigger"
);
const ContextMenuGroup = compactPart(
  ContextMenuPrimitive.Group,
  MenuSheetGroup,
  "ContextMenuGroup"
);
const ContextMenuPortal = (
  props: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Portal>
) =>
  useViewport().isPhone ? (
    <MenuSheetPortal {...props} />
  ) : (
    <ContextMenuPrimitive.Portal {...props} />
  );
const ContextMenuSub = (
  props: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Sub>
) =>
  useViewport().isPhone ? (
    <MenuSheetSub {...props} />
  ) : (
    <ContextMenuPrimitive.Sub {...props} />
  );
const ContextMenuRadioGroup = compactPart(
  ContextMenuPrimitive.RadioGroup,
  MenuSheetRadioGroup,
  "ContextMenuRadioGroup"
);
const ContextMenuSubTrigger = compactPart(
  DesktopContextMenuSubTrigger,
  MenuSheetSubTrigger,
  "ContextMenuSubTrigger"
);
const ContextMenuSubContent = compactPart(
  DesktopContextMenuSubContent,
  MenuSheetSubContent,
  "ContextMenuSubContent"
);
const ContextMenuContent = compactPart(
  DesktopContextMenuContent,
  MenuSheetContent,
  "ContextMenuContent"
);
const ContextMenuItem = compactPart(
  DesktopContextMenuItem,
  MenuSheetItem,
  "ContextMenuItem"
);
const ContextMenuCheckboxItem = compactPart(
  DesktopContextMenuCheckboxItem,
  MenuSheetCheckboxItem,
  "ContextMenuCheckboxItem"
);
const ContextMenuRadioItem = compactPart(
  DesktopContextMenuRadioItem,
  MenuSheetRadioItem,
  "ContextMenuRadioItem"
);
const ContextMenuLabel = compactPart(
  DesktopContextMenuLabel,
  MenuSheetLabel,
  "ContextMenuLabel"
);
const ContextMenuSeparator = compactPart(
  DesktopContextMenuSeparator,
  MenuSheetSeparator,
  "ContextMenuSeparator"
);

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
};
