// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef } from "react";
import {
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle
} from "./BottomSheet";
import { cn } from "./utils/cn";

/** Positioning props a popper content takes that a bottom sheet has no use for. */
export type PopperPositionProps = {
  side?: unknown;
  sideOffset?: unknown;
  align?: unknown;
  alignOffset?: unknown;
  arrowPadding?: unknown;
  avoidCollisions?: unknown;
  collisionBoundary?: unknown;
  collisionPadding?: unknown;
  sticky?: unknown;
  hideWhenDetached?: unknown;
  updatePositionStrategy?: unknown;
};

type PopupSheetContentProps = Omit<
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "title"
> &
  PopperPositionProps & {
    /** Shown as the sheet's title; a hidden fallback names it otherwise. */
    label?: ReactNode;
    children?: ReactNode;
  };

/**
 * Phones: a popover-like surface (popover, hover card) shown as a bottom
 * sheet. The caller's className styles the body; its width classes give way
 * to the sheet's full width.
 */
export const PopupSheetContent = forwardRef<
  HTMLDivElement,
  PopupSheetContentProps
>(
  (
    {
      label,
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
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
    return (
      <BottomSheetContent ref={ref} {...props}>
        <BottomSheetHeader>
          <BottomSheetTitle className={label ? undefined : "sr-only"}>
            {label ?? t`Details`}
          </BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className={cn("text-[15px]", className, "w-full max-w-none")}>
            {children}
          </div>
        </BottomSheetBody>
      </BottomSheetContent>
    );
  }
);
PopupSheetContent.displayName = "PopupSheetContent";
