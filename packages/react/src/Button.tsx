// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Slot, Slottable } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, MouseEvent, ReactElement } from "react";
import { cloneElement, forwardRef, useCallback, useRef } from "react";
import { useActionPresentation } from "./ActionPresentation";
import type { ShortcutInput } from "./hooks/useShortcutKeys";
import { useShortcutKeys } from "./hooks/useShortcutKeys";
import { ShortcutKey } from "./ShortcutKey";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";
import { hasOpenDialog, isInsideTopmostDialog } from "./utils/dialog";
import { mergeRefs } from "./utils/react";
import { HitArea, useViewport } from "./Viewport";

export const buttonVariants = cva(
  [
    "relative font-medium shrink-0 group inline-flex items-center justify-center select-none transform-gpu initial:border-none disabled:opacity-50",
    "focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0 whitespace-nowrap",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-lg after:border after:border-blue-500 after:opacity-0 after:ring-2 after:ring-blue-500/20 after:transition-opacity after:duration-150 after:ease-out focus-visible:after:opacity-100 active:after:opacity-0",
    // Transition: background/colors use 'ease' (150ms), transform uses 'ease-out' for responsive press feel
    "transform-gpu transition-[background-color,color,transform,box-shadow] duration-150 ease",
    // Active state: subtle scale down for tactile press feedback
    "active:scale-[0.98] active:duration-75 active:ease-out",
    // Accessibility: respect reduced motion preferences
    "motion-reduce:transform-none motion-reduce:transition-[background-color,color,box-shadow] corner-squircle"
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-br from-primary/90 to-primary text-primary-foreground hover:bg-primary/90 saturate-[105%] shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)] before:pointer-events-none before:bg-gradient-to-b before:transition-opacity before:duration-100 before:ease before:from-white/[0.12] before:absolute before:inset-0 before:z-[1] before:rounded before:opacity-0 hover:before:opacity-100 active:before:opacity-0",
        active:
          "bg-active text-active-foreground hover:bg-active/90 hover:text-active-foreground dark:shadow-button-base before:hidden",
        secondary:
          "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        solid: "bg-accent text-accent-foreground hover:bg-accent/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)] before:pointer-events-none before:bg-gradient-to-b before:transition-opacity before:duration-100 before:ease before:from-white/[0.12] before:absolute before:inset-0 before:z-[1] before:rounded before:opacity-0 hover:before:opacity-100 active:before:opacity-0",
        ghost:
          "bg-transparent hover:bg-primary/10 text-accent-foreground hover:text-accent-foreground/90 before:hidden",
        outline:
          "bg-transparent border border-border text-foreground hover:bg-accent hover:text-accent-foreground before:hidden",
        link: "text-foreground hover:text-foreground underline-offset-4 hover:underline px-0 py-0 before:hidden"
      },
      size: {
        sm: "h-6 rounded-sm text-xs",
        md: "h-8 rounded-md text-sm",
        lg: "h-11 rounded-lg text-base"
      },
      isDisabled: {
        true: "opacity-50 disabled:cursor-not-allowed"
      },
      isLoading: {
        true: "opacity-50 pointer-events-none"
      },
      isIcon: {
        true: "",
        false: ""
      },
      isRound: {
        true: "rounded-full before:rounded-full after:rounded-full",
        false: "rounded-md"
      }
    },
    compoundVariants: [
      {
        size: "sm",
        isIcon: true,
        class: "w-6 p-1"
      },
      {
        size: "md",
        isIcon: true,
        class: "w-8 p-2"
      },
      {
        size: "lg",
        isIcon: true,
        class: "w-11 p-2"
      },
      {
        size: "sm",
        isIcon: false,
        class: "px-2"
      },
      {
        size: "md",
        isIcon: false,
        class: "px-4"
      },
      {
        size: "lg",
        isIcon: false,
        class: "px-6"
      },
      {
        variant: "link",
        size: "sm",
        class: "px-0 py-0"
      },
      {
        variant: "link",
        size: "md",
        class: "px-0 py-0"
      },
      {
        variant: "link",
        size: "lg",
        class: "px-0 py-0"
      }
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      isRound: false
    }
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isDisabled?: boolean;
  isIcon?: boolean;
  isLoading?: boolean;
  leftIcon?: ReactElement;
  rightIcon?: ReactElement;
  isRound?: boolean;
  /**
   * Keyboard binding(s) that click this button — a react-hotkeys-hook string
   * like `"mod+s"` or `"enter"` (or a structured `ShortcutDefinition` for
   * per-platform combos), or an array of alternatives that all trigger the
   * action; the badge shows the first. Inert while the button is disabled or
   * loading, and while a dialog the button isn't inside is open.
   */
  shortcut?: ShortcutInput | ShortcutInput[];
  /** Keep the hotkey active but hide the visual key badge. */
  hideShortcutKey?: boolean;
  /** Extra guard AND-composed with the built-in topmost-dialog guard. */
  shortcutGuard?: (event: KeyboardEvent) => boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      variant,
      size,
      isDisabled,
      isIcon = false,
      isLoading,
      isRound = false,
      leftIcon,
      rightIcon,
      shortcut,
      hideShortcutKey = false,
      shortcutGuard,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const innerRef = useRef<HTMLButtonElement>(null);
    const presentation = useActionPresentation();
    const { isPhone } = useViewport();
    // The badge shows the first binding; the rest are silent alternatives.
    const primaryShortcut = Array.isArray(shortcut) ? shortcut[0] : shortcut;
    const badgeShortcut =
      !hideShortcutKey && !isIcon && !isLoading ? primaryShortcut : undefined;

    // While any dialog is open, only buttons inside the TOPMOST one respond
    // to their shortcut — a background (or outer-dialog) ⌘S must not fire
    // under a confirmation modal stacked on top.
    const dialogGuard = useCallback(
      (event: KeyboardEvent) =>
        (!hasOpenDialog() || isInsideTopmostDialog(innerRef.current)) &&
        (shortcutGuard?.(event) ?? true),
      [shortcutGuard]
    );

    // Ref-click (not a direct onClick call) so type="submit" buttons submit
    // their form, and a disabled element's click() stays a native no-op.
    // preventDefault first: when THIS button has focus, a bare Enter/Space
    // would also activate it natively — one keypress, two clicks — and for
    // combos it suppresses browser defaults like ⌘S's save dialog.
    const clickSelf = useCallback((event: KeyboardEvent) => {
      event.preventDefault();
      innerRef.current?.click();
    }, []);

    useShortcutKeys({
      shortcut,
      action: clickSelf,
      guard: dialogGuard,
      disabled: Boolean(isDisabled || props.disabled || isLoading)
    });

    // Phones, inside a record action: a bottom-bar cell or an action-sheet
    // row (see ActionPresentation).
    const isRow = presentation?.kind === "row";
    // A square bar cell (Preview): the left icon, the label for screen readers.
    const isIconCell =
      presentation?.kind === "bar" && presentation.iconOnly === true;
    const onClick = isRow
      ? (event: MouseEvent<HTMLButtonElement>) => {
          props.onClick?.(event);
          if (event.defaultPrevented || props["aria-haspopup"]) return;
          // Next task, so a submit button's form is still mounted when the
          // browser submits it.
          setTimeout(presentation.onSelect, 0);
        }
      : props.onClick;

    return (
      <Comp
        {...props}
        onClick={onClick}
        className={cn(
          buttonVariants({
            variant:
              presentation?.kind === "bar"
                ? presentation.emphasis
                : isRow
                  ? "ghost"
                  : variant,
            size: presentation ? "lg" : size,
            isDisabled,
            isIcon: isIcon || isIconCell,
            isLoading,
            isRound,
            className
          }),
          presentation?.kind === "bar" &&
            (isIconCell ? "shrink-0" : "w-full min-w-0"),
          isRow &&
            "h-12 w-full min-w-0 shrink justify-start rounded-sm px-3 text-[15px] font-normal text-foreground shadow-none",
          isRow && variant === "destructive" && "text-destructive"
        )}
        type={asChild ? undefined : (props.type ?? "button")}
        // `isLoading` disables too. It already blocks the keyboard path via
        // `useShortcutKeys` above, so leaving it out here made the component
        // internally inconsistent: a spinning button refused Enter but still
        // took a mouse click. Every call site that guards a submit with
        // `isLoading={fetcher.state !== "idle"}` — and there are many — was
        // therefore showing a spinner over a live button, which is worse than
        // no spinner: it says "working on it" while accepting another click.
        disabled={isDisabled || props.disabled || isLoading}
        role={asChild ? undefined : "button"}
        ref={mergeRefs(ref, innerRef)}
      >
        {isPhone && <HitArea />}
        {isLoading && (
          <Spinner className={cn("size-4 flex-shrink-0", !isIcon && "mr-2")} />
        )}
        {!isLoading &&
          leftIcon &&
          cloneElement(leftIcon, {
            className: isIconCell
              ? cn("size-5 flex-shrink-0", leftIcon.props.className)
              : !leftIcon.props?.size
                ? cn("mr-2 h-4 w-4 flex-shrink-0", leftIcon.props.className)
                : cn("mr-2 flex-shrink-0", leftIcon.props.className)
          })}
        {/* An icon button's icon arrives as children — while loading, the
            spinner must REPLACE it or both clip inside the square hit area. */}
        {isIcon && isLoading ? null : isIconCell ? (
          <span className="sr-only">
            <Slottable>{children}</Slottable>
          </span>
        ) : (
          <Slottable>{children}</Slottable>
        )}
        {badgeShortcut && (
          <ShortcutKey
            shortcut={badgeShortcut}
            variant={size === "lg" ? "medium" : "small"}
          />
        )}
        {/* The badge owns the trailing slot — a rightIcon next to it reads
            cluttered, so the badge wins while it's visible. */}
        {!badgeShortcut &&
          !isIconCell &&
          rightIcon &&
          cloneElement(rightIcon, {
            className: !rightIcon.props?.size
              ? cn("ml-2 h-4 w-4 flex-shrink-0", rightIcon.props.className)
              : cn("ml-2 flex-shrink-0", rightIcon.props.className)
          })}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button };
