// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
  ReactElement
} from "react";
import { cloneElement, forwardRef } from "react";
import { LuCheck, LuChevronRight } from "react-icons/lu";
import { ActionPresentationBoundary } from "./ActionPresentation";
import { BottomSheetTrigger } from "./BottomSheet";
import {
  compactPart,
  MenuSheetCheckboxItem,
  MenuSheetContent,
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

const DesktopDropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <LuChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DesktopDropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DesktopDropdownMenuSubContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, onKeyDown, children, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      onKeyDown={withMenuShortcuts(onKeyDown)}
      className={cn(
        "z-50 origin-(--radix-dropdown-menu-content-transform-origin) min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 shadow-md dark:shadow-[0px_0px_0px_0.5px_rgba(0,0,0,1),_0px_4px_4px_rgba(0,0,0,0.24)]",
        className
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.SubContent>
  );
});
DesktopDropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

const DesktopDropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, onKeyDown, children, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        onKeyDown={withMenuShortcuts(onKeyDown)}
        sideOffset={sideOffset}
        className={cn(
          "z-50 origin-(--radix-dropdown-menu-content-transform-origin) min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 shadow-md dark:shadow-[0px_0px_0px_0.5px_rgba(0,0,0,1),_0px_4px_4px_rgba(0,0,0,0.24)]",
          className
        )}
        {...props}
      >
        <ActionPresentationBoundary>{children}</ActionPresentationBoundary>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
});
DesktopDropdownMenuContent.displayName =
  DropdownMenuPrimitive.Content.displayName;

export interface DropdownMenuIconProps extends ComponentPropsWithoutRef<"svg"> {
  icon: ReactElement;
}

const DropdownMenuIcon = forwardRef<ElementRef<"span">, DropdownMenuIconProps>(
  ({ className, icon, children, ...props }, ref) => {
    return cloneElement(icon, {
      className: cn("mr-2 h-4 w-4 max-md:mr-0 max-md:size-5", className),
      ...props
    });
  }
);
DropdownMenuIcon.displayName = "DropdownMenuIcon";

const DesktopDropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
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
    <DropdownMenuPrimitive.Item
      ref={ref}
      asChild={asChild}
      data-menu-shortcut={shortcut}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
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
          <DropdownMenuShortcut className="shrink-0 pl-4">
            <ShortcutKey shortcut={shortcut} variant="small" className="mx-0" />
          </DropdownMenuShortcut>
        </>
      )}
    </DropdownMenuPrimitive.Item>
  )
);
DesktopDropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DesktopDropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <LuCheck className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DesktopDropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

const DesktopDropdownMenuRadioItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <LuCheck className="h-4 w-4 " />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
));
DesktopDropdownMenuRadioItem.displayName =
  DropdownMenuPrimitive.RadioItem.displayName;

const DesktopDropdownMenuLabel = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-xs text-muted-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DesktopDropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DesktopDropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(
      "-mx-1 my-1 h-px bg-muted dark:bg-gray-900 dark:shadow-[0px_1px_0px_rgb(255_255_255_/_0.05)]",
      className
    )}
    {...props}
  />
));
DesktopDropdownMenuSeparator.displayName =
  DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  );
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

/*
 * Phones render each part from MenuSheet (a bottom sheet) instead of Radix's
 * menu; see MenuSheet.tsx.
 */
const DropdownMenu = (
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>
) =>
  useViewport().isPhone ? (
    <MenuSheetRoot {...props} />
  ) : (
    <DropdownMenuPrimitive.Root {...props} />
  );
const DropdownMenuTrigger = compactPart(
  DropdownMenuPrimitive.Trigger,
  BottomSheetTrigger,
  "DropdownMenuTrigger"
);
const DropdownMenuGroup = compactPart(
  DropdownMenuPrimitive.Group,
  MenuSheetGroup,
  "DropdownMenuGroup"
);
const DropdownMenuPortal = (
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Portal>
) =>
  useViewport().isPhone ? (
    <MenuSheetPortal {...props} />
  ) : (
    <DropdownMenuPrimitive.Portal {...props} />
  );
const DropdownMenuSub = (
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>
) =>
  useViewport().isPhone ? (
    <MenuSheetSub {...props} />
  ) : (
    <DropdownMenuPrimitive.Sub {...props} />
  );
const DropdownMenuRadioGroup = compactPart(
  DropdownMenuPrimitive.RadioGroup,
  MenuSheetRadioGroup,
  "DropdownMenuRadioGroup"
);
const DropdownMenuSubTrigger = compactPart(
  DesktopDropdownMenuSubTrigger,
  MenuSheetSubTrigger,
  "DropdownMenuSubTrigger"
);
const DropdownMenuSubContent = compactPart(
  DesktopDropdownMenuSubContent,
  MenuSheetSubContent,
  "DropdownMenuSubContent"
);
const DropdownMenuContent = compactPart(
  DesktopDropdownMenuContent,
  MenuSheetContent,
  "DropdownMenuContent"
);
const DropdownMenuItem = compactPart(
  DesktopDropdownMenuItem,
  MenuSheetItem,
  "DropdownMenuItem"
);
const DropdownMenuCheckboxItem = compactPart(
  DesktopDropdownMenuCheckboxItem,
  MenuSheetCheckboxItem,
  "DropdownMenuCheckboxItem"
);
const DropdownMenuRadioItem = compactPart(
  DesktopDropdownMenuRadioItem,
  MenuSheetRadioItem,
  "DropdownMenuRadioItem"
);
const DropdownMenuLabel = compactPart(
  DesktopDropdownMenuLabel,
  MenuSheetLabel,
  "DropdownMenuLabel"
);
const DropdownMenuSeparator = compactPart(
  DesktopDropdownMenuSeparator,
  MenuSheetSeparator,
  "DropdownMenuSeparator"
);

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
};
