// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type * as DialogPrimitive from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  ElementType,
  MouseEvent,
  PointerEvent,
  ReactNode
} from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { LuCheck, LuChevronRight } from "react-icons/lu";
import {
  BottomSheet,
  BottomSheetBack,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  SheetSectionLabel,
  sheetRowClassName
} from "./BottomSheet";
import type { PopperPositionProps } from "./PopupSheet";
import { cn } from "./utils/cn";
import { useViewport } from "./Viewport";

/*
 * Phones: a dropdown or context menu shown as a real bottom sheet (a Radix
 * Dialog), not Radix's menu. Radix menu items only work inside Radix's menu
 * content, so the menu's parts switch to these on compact. A submenu opens as
 * a drill-in page with ‹ Back.
 */

type Page = { id: string; label: ReactNode };

type MenuSheetState = {
  setOpen: (open: boolean) => void;
  pages: Page[];
  push: (page: Page) => void;
  pop: () => void;
};

const MenuSheetContext = createContext<MenuSheetState | null>(null);

function useMenuSheet() {
  const context = useContext(MenuSheetContext);
  if (!context) throw new Error("Menu parts must be used within a menu");
  return context;
}

/** The page an item belongs to: `null` is the menu's first page. */
const LevelContext = createContext<string | null>(null);

/** True when the item's page is the one showing. */
function useOnPage() {
  const { pages } = useMenuSheet();
  const level = useContext(LevelContext);
  return (pages.at(-1)?.id ?? null) === level;
}

export function MenuSheetRoot({
  open: openProp,
  defaultOpen,
  onOpenChange,
  children
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false
  );
  const [pages, setPages] = useState<Page[]>([]);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    if (!next) setPages([]);
    onOpenChange?.(next);
  };

  return (
    <MenuSheetContext.Provider
      value={{
        setOpen,
        pages,
        push: (page) => setPages((p) => [...p, page]),
        pop: () => setPages((p) => p.slice(0, -1))
      }}
    >
      <BottomSheet open={open} onOpenChange={setOpen}>
        {children}
      </BottomSheet>
    </MenuSheetContext.Provider>
  );
}

const LONG_PRESS_MS = 500;
/** A held finger drifts; only a move past this many pixels is a scroll. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * A context menu's trigger: a right-click, or a touch held still for half a
 * second, opens the sheet.
 */
export const MenuSheetContextTrigger = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span"> & { asChild?: boolean; disabled?: boolean }
>(
  (
    {
      asChild,
      disabled,
      className,
      onClickCapture,
      onContextMenu,
      onPointerDown,
      ...props
    },
    ref
  ) => {
    const { setOpen } = useMenuSheet();
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const start = useRef<{ x: number; y: number } | null>(null);
    // The click that follows a long-press release must not reach the row.
    const fired = useRef(false);
    const clear = () => {
      clearTimeout(timer.current);
      start.current = null;
    };
    useEffect(() => () => clearTimeout(timer.current), []);
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref}
        {...props}
        className={cn("[-webkit-touch-callout:none] select-none", className)}
        onContextMenu={(event: MouseEvent<HTMLSpanElement>) => {
          onContextMenu?.(event);
          if (disabled || event.defaultPrevented) return;
          event.preventDefault();
          setOpen(true);
        }}
        onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
          onPointerDown?.(event);
          fired.current = false;
          if (disabled || event.pointerType !== "touch") return;
          clear();
          start.current = { x: event.clientX, y: event.clientY };
          timer.current = setTimeout(() => {
            fired.current = true;
            start.current = null;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event: PointerEvent<HTMLSpanElement>) => {
          const origin = start.current;
          if (
            origin &&
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
              LONG_PRESS_SLOP_PX
          ) {
            clear();
          }
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onClickCapture={(event: MouseEvent<HTMLSpanElement>) => {
          if (fired.current) {
            fired.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClickCapture?.(event);
        }}
      />
    );
  }
);
MenuSheetContextTrigger.displayName = "MenuSheetContextTrigger";

export const MenuSheetContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> &
    PopperPositionProps & { loop?: unknown }
>(
  (
    {
      className,
      children,
      side: _side,
      sideOffset: _sideOffset,
      align: _align,
      alignOffset: _alignOffset,
      arrowPadding: _arrowPadding,
      avoidCollisions: _avoidCollisions,
      collisionBoundary: _collisionBoundary,
      collisionPadding: _collisionPadding,
      sticky: _sticky,
      hideWhenDetached: _hideWhenDetached,
      updatePositionStrategy: _updatePositionStrategy,
      loop: _loop,
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
    const { pages, pop } = useMenuSheet();
    const page = pages.at(-1);
    const label = props["aria-label"];
    return (
      <BottomSheetContent ref={ref} {...props}>
        <BottomSheetHeader>
          {page ? <BottomSheetBack onClick={pop} /> : null}
          <BottomSheetTitle className={page || label ? undefined : "sr-only"}>
            {page?.label ?? label ?? t`Options`}
          </BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div
            role="menu"
            className={cn("flex flex-col", className, "w-full max-w-none")}
          >
            {children}
          </div>
        </BottomSheetBody>
      </BottomSheetContent>
    );
  }
);
MenuSheetContent.displayName = "MenuSheetContent";

type ItemProps = Omit<ComponentPropsWithoutRef<"button">, "onSelect"> & {
  asChild?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  inset?: boolean;
  /** A menu-only key; phones have no keyboard to press it with. */
  shortcut?: unknown;
  textValue?: string;
  /** As Radix: call `event.preventDefault()` to keep the menu open. */
  onSelect?: (event: Event) => void;
};

/** Runs `onSelect` as Radix does, then closes unless it was prevented. */
function useSelect(onSelect?: (event: Event) => void) {
  const { setOpen } = useMenuSheet();
  return () => {
    const event = new Event("menu.itemSelect", { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) setOpen(false);
  };
}

export const MenuSheetItem = forwardRef<HTMLButtonElement, ItemProps>(
  (
    {
      asChild,
      disabled,
      destructive,
      inset: _inset,
      shortcut: _shortcut,
      textValue: _textValue,
      onSelect,
      onClick,
      className,
      ...props
    },
    ref
  ) => {
    const onPage = useOnPage();
    const select = useSelect(onSelect);
    if (!onPage) return null;
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        role="menuitem"
        type={asChild ? undefined : "button"}
        disabled={asChild ? undefined : disabled}
        aria-disabled={disabled || undefined}
        className={cn(
          sheetRowClassName,
          destructive && "text-destructive",
          className
        )}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (disabled || event.defaultPrevented) return;
          select();
        }}
        {...props}
      />
    );
  }
);
MenuSheetItem.displayName = "MenuSheetItem";

export const MenuSheetCheckboxItem = forwardRef<
  HTMLButtonElement,
  ItemProps & {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (checked: boolean) => void;
  }
>(({ checked, onCheckedChange, onSelect, children, ...props }, ref) => (
  <MenuSheetItem
    ref={ref}
    role="menuitemcheckbox"
    aria-checked={checked === "indeterminate" ? "mixed" : Boolean(checked)}
    onSelect={(event) => {
      onCheckedChange?.(checked !== true);
      onSelect?.(event);
    }}
    {...props}
  >
    <span className="flex size-5 shrink-0 items-center justify-center">
      {checked ? <LuCheck className="size-5 text-primary" /> : null}
    </span>
    {children}
  </MenuSheetItem>
));
MenuSheetCheckboxItem.displayName = "MenuSheetCheckboxItem";

const RadioContext = createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
}>({});

export function MenuSheetRadioGroup({
  value,
  onValueChange,
  children,
  className
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <RadioContext.Provider value={{ value, onValueChange }}>
      <div role="group" className={className}>
        {children}
      </div>
    </RadioContext.Provider>
  );
}

export const MenuSheetRadioItem = forwardRef<
  HTMLButtonElement,
  ItemProps & { value: string }
>(({ value, onSelect, children, ...props }, ref) => {
  const radio = useContext(RadioContext);
  const checked = radio.value === value;
  return (
    <MenuSheetItem
      ref={ref}
      role="menuitemradio"
      aria-checked={checked}
      onSelect={(event) => {
        radio.onValueChange?.(value);
        onSelect?.(event);
      }}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {checked ? <LuCheck className="size-5 shrink-0 text-primary" /> : null}
    </MenuSheetItem>
  );
});
MenuSheetRadioItem.displayName = "MenuSheetRadioItem";

export const MenuSheetLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & { inset?: boolean }
>(({ className, inset: _inset, ...props }, ref) => {
  const onPage = useOnPage();
  if (!onPage) return null;
  return <SheetSectionLabel ref={ref} className={className} {...props} />;
});
MenuSheetLabel.displayName = "MenuSheetLabel";

export const MenuSheetSeparator = forwardRef<
  HTMLHRElement,
  ComponentPropsWithoutRef<"hr">
>(({ className, ...props }, ref) => {
  const onPage = useOnPage();
  if (!onPage) return null;
  return (
    <hr
      ref={ref}
      className={cn("my-2 h-px border-0 bg-border", className)}
      {...props}
    />
  );
});
MenuSheetSeparator.displayName = "MenuSheetSeparator";

const SubContext = createContext<string | null>(null);

export function MenuSheetSub({ children }: { children?: ReactNode }) {
  const id = useId();
  return <SubContext.Provider value={id}>{children}</SubContext.Provider>;
}

export function MenuSheetGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div role="group" className={className} {...props} />;
}

/** A row that opens its submenu as the sheet's next page. */
export const MenuSheetSubTrigger = forwardRef<HTMLButtonElement, ItemProps>(
  (
    {
      children,
      disabled,
      className,
      inset: _inset,
      textValue: _textValue,
      shortcut: _shortcut,
      onSelect: _onSelect,
      ...props
    },
    ref
  ) => {
    const subId = useContext(SubContext);
    const { push } = useMenuSheet();
    const onPage = useOnPage();
    if (!onPage || !subId) return null;
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        disabled={disabled}
        className={cn(sheetRowClassName, className)}
        {...props}
        onClick={() => push({ id: subId, label: children })}
      >
        {children}
        <LuChevronRight className="ml-auto size-5 shrink-0 text-muted-foreground" />
      </button>
    );
  }
);
MenuSheetSubTrigger.displayName = "MenuSheetSubTrigger";

/** A submenu's items: they show only on its page. */
export function MenuSheetSubContent({ children }: { children?: ReactNode }) {
  const subId = useContext(SubContext);
  return (
    <LevelContext.Provider value={subId}>{children}</LevelContext.Provider>
  );
}

/**
 * A menu part that renders `Phone` on compact and the Radix `Desktop` part
 * elsewhere, with the same props, so call sites stay unchanged.
 */
export function compactPart<T extends ElementType>(
  Desktop: T,
  Phone: ElementType,
  displayName?: string
) {
  const Part = forwardRef<ElementRef<T>, ComponentPropsWithoutRef<T>>(
    (props, ref) => {
      const Comp: ElementType = useViewport().isPhone ? Phone : Desktop;
      return <Comp ref={ref} {...props} />;
    }
  );
  Part.displayName = displayName;
  return Part;
}

/** Phones: menu contents render in the sheet, not a portal of their own. */
export function MenuSheetPortal({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
